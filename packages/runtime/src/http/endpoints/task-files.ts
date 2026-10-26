import { servePDFAsset, pdfPreviewHTML } from './pdf-preview.js'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'
import { open, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, isAbsolute, relative, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileTypeFromBuffer } from 'file-type'
import {
  decode,
  taskFileRequestSchema,
  taskFileOpenSchema,
  localMarkdownPath,
  richMarkdownPaths,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import { safeFile, repositoryPath } from '../../scm/repositories/paths.js'
import { newSecret, hashSecret } from '../../auth/devices.js'
import type { ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'

function messagePaths(text: string) {
  const tree = fromMarkdown(text)
  const definitions = new Map<string, string>()
  const paths: string[] = []
  const visit = (node: Nodes) => {
    if (node.type === 'definition') definitions.set(node.identifier, node.url)
    if (node.type === 'link' || node.type === 'image') paths.push(node.url)
    if ('children' in node) node.children.forEach(visit)
  }
  visit(tree)
  const references = (node: Nodes) => {
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      const value = definitions.get(node.identifier)
      if (value) paths.push(value)
    }
    if ('children' in node) node.children.forEach(references)
  }
  references(tree)
  return [...paths, ...richMarkdownPaths(text)]
}
function filename(value: string, cwd: string) {
  const path = localMarkdownPath(value)
  if (path === undefined) throw new HttpError(400, 'Use a local file path')
  try {
    return /^file:/i.test(path) ? fileURLToPath(path) : resolve(cwd, decodeURIComponent(path))
  } catch {
    throw new HttpError(400, 'Invalid file path')
  }
}
export async function sharedTaskFile(s: Services, taskId: string, path: string) {
  const task = s.store.task(taskId)
  const cwd = await s.checkouts.fileDirectory(task.id)
  const full = filename(path, cwd)
  const replies = [
    ...task.messages
      .filter((message) => message.role === 'assistant')
      .map((message) => message.text),
    ...(task.sideChats ?? []).flatMap((chat) =>
      chat.messages.flatMap((message) => (message.answer ? [message.answer] : [])),
    ),
  ]
  for (const reply of replies) {
    for (const link of messagePaths(reply)) {
      if (localMarkdownPath(link) === undefined) continue
      try {
        if (filename(link, cwd) === full) return realpath(full)
      } catch (error) {
        if (!(error instanceof HttpError && error.status === 400)) throw error
      }
    }
  }
  const rel = relative(cwd, full)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\'))
    throw new HttpError(403, 'This file is not shared by the thread')
  return safeFile(await repositoryPath(cwd), rel)
}
async function openSharedFile(s: Services, taskId: string, path: string) {
  try {
    const target = await sharedTaskFile(s, taskId, path)
    return { target, handle: await open(target, constants.O_RDONLY | constants.O_NOFOLLOW) }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR'].includes(String(error.code))
    )
      throw new HttpError(404, 'This file is no longer available')
    throw error
  }
}
type Grant = { taskId: string; path: string; token: string; expires: number }
const grants = new WeakMap<Services, Map<string, Grant>>()
function store(s: Services) {
  let entries = grants.get(s)
  if (!entries) {
    entries = new Map()
    grants.set(s, entries)
  }
  for (const [key, value] of entries) if (value.expires <= Date.now()) entries.delete(key)
  return entries
}
export async function shareTaskFile(s: Services, value: unknown, token: string) {
  const input = decode(taskFileRequestSchema, value)
  const { handle } = await openSharedFile(s, input.taskId, input.path)
  try {
    if (!(await handle.stat()).isFile()) throw new HttpError(400, 'Choose a regular file')
  } finally {
    await handle.close()
  }
  const entries = store(s)
  if (entries.size >= 1000) throw new HttpError(429, 'Too many file previews; try again later')
  const ticket = newSecret()
  entries.set(hashSecret(ticket), { ...input, token, expires: Date.now() + 15 * 60_000 })
  return { url: `/api/tasks/files/shared/${ticket}` }
}
export async function taskFileLocation(s: Services, value: unknown) {
  const input = decode(taskFileRequestSchema, value)
  const { target, handle } = await openSharedFile(s, input.taskId, input.path)
  try {
    if (!(await handle.stat()).isFile()) throw new HttpError(400, 'Choose a regular file')
    return {
      path: target,
      runtimeId: s.runtimeId,
      sshAddress: s.preferences.get().sshAddress,
      kind: 'file',
    }
  } finally {
    await handle.close()
  }
}
export async function openTaskFile(s: Services, value: unknown) {
  const input = decode(taskFileOpenSchema, value)
  const { target, handle } = await openSharedFile(s, input.taskId, input.path)
  try {
    if (!(await handle.stat()).isFile()) throw new HttpError(400, 'Choose a regular file')
    await s.git.openFile(target, input.target)
  } finally {
    await handle.close()
  }
  return { ok: true, revision: s.store.version() }
}
/** Read a shared visualization through its runtime, then render in the artifact sandbox. */
export async function readTaskVisualization(s: Services, value: unknown) {
  const input = decode(taskFileRequestSchema, value)
  const { target, handle } = await openSharedFile(s, input.taskId, input.path)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > 100 * 1024 * 1024)
      throw new HttpError(413, 'Visualizations must be HTML files up to 100 MB')
    if (!/\.html?$/i.test(target)) throw new HttpError(415, 'Use an HTML visualization')
    const contents = await handle.readFile('utf8')
    if (contents.includes('\0')) throw new HttpError(415, 'Binary files cannot be visualizations')
    return { path: input.path, contents }
  } finally {
    await handle.close()
  }
}
const escapeHTML = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  )

/** File-specific expiring grants, never the paired device token, travel into browser URLs. */
export async function serveTaskFile(
  s: Services,
  response: ServerResponse,
  url: URL,
  range?: string,
) {
  const ticket = url.pathname.slice('/api/tasks/files/shared/'.length)
  const grant = store(s).get(hashSecret(ticket))
  if (!grant) throw new HttpError(401, 'File preview expired. Open the link again from the chat.')
  s.devices.authenticate(grant.token)
  const { target, handle } = await openSharedFile(s, grant.taskId, grant.path)
  try {
    if (await servePDFAsset(response, url)) return
    const info = await handle.stat()
    if (!info.isFile()) throw new HttpError(400, 'Choose a regular file')
    const sample = Buffer.alloc(Math.min(info.size, 8192))
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0)
    const data = sample.subarray(0, bytesRead)
    const type = await fileTypeFromBuffer(data)
    const extension = extname(target).toLowerCase()
    let text = !data.includes(0) && !type
    if (text) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(data, { stream: info.size > bytesRead })
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
        text = false
      }
    }
    const mime =
      type?.mime ??
      (text
        ? extension === '.html' || extension === '.htm'
          ? 'text/html'
          : extension === '.svg'
            ? 'image/svg+xml'
            : 'text/plain'
        : 'application/octet-stream')
    const sandboxed = mime === 'text/html' || mime === 'image/svg+xml'
    const previewable =
      mime.startsWith('image/') ||
      mime.startsWith('text/') ||
      mime === 'application/pdf' ||
      mime.startsWith('video/') ||
      mime.startsWith('audio/')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (!url.searchParams.has('content') && !url.searchParams.has('download')) {
      const plainText = mime === 'text/plain'
      const pdf = mime === 'application/pdf'
      const nonce = newSecret()
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      // The scoped grant page can be embedded by Studio on a different origin.
      // File HTML/SVG remains sandboxed in the nested content frame.
      response.setHeader(
        'Content-Security-Policy',
        `default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; media-src 'self'; ${pdf ? `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; font-src 'self' data:;` : ''} base-uri 'none'; form-action 'none'`,
      )
      const download = `${url.pathname}?download=1`
      const preview = `${url.pathname}?content=1`
      const media = mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
          ? 'audio'
          : undefined
      const content = plainText
        ? '<main class="text-preview" aria-label="File preview"><pre><code>'
        : pdf
          ? pdfPreviewHTML(nonce, url.pathname)
          : media
            ? `<${media} controls playsinline preload="metadata" style="width:100%;max-height:80dvh" src="${preview}"></${media}>`
            : previewable
              ? `<iframe ${sandboxed ? 'sandbox' : ''} title="File preview" src="${preview}"></iframe>`
              : '<p>This file has no browser preview. Download the original to open it.</p>'
      const page = `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(basename(target))}</title><style>body{margin:0;font:14px system-ui;background:#111;color:#eee}header{padding:16px;display:flex;gap:20px;align-items:center;flex-wrap:wrap}a{color:#8acfff}nav{display:flex;gap:8px;align-items:center;padding:12px;flex-wrap:wrap}button{padding:8px}canvas{display:block;margin:12px auto;background:white}iframe{width:100%;height:calc(100dvh - 72px);border:0;background:white}.text-preview{min-height:calc(100dvh - 72px);background:white;color:black;color-scheme:only light}.text-preview pre{margin:0;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere}p{padding:16px}</style><header><strong>${escapeHTML(basename(target))}</strong><a href="${download}" download>Download original</a><span>Temporary preview · 15 minutes</span></header>${content}`
      if (plainText) {
        // Own the text document's colors instead of relying on the browser's text viewer.
        // Decode incrementally so UTF-8 characters spanning stream chunks stay intact.
        const source = handle.createReadStream({ start: 0, autoClose: false, encoding: 'utf8' })
        await pipeline(
          (async function* () {
            yield page
            for await (const chunk of source) yield escapeHTML(String(chunk))
            yield '</code></pre></main></html>'
          })(),
          response,
        )
      } else response.end(page + '</html>')
      return
    }
    const download = url.searchParams.has('download')
    response.setHeader(
      'Content-Type',
      download
        ? 'application/octet-stream'
        : `${mime}${mime.startsWith('text/') ? '; charset=utf-8' : ''}`,
    )
    response.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(basename(target)).replace(/'/g, '%27')}`,
    )
    response.setHeader(
      'Content-Security-Policy',
      `${sandboxed ? 'sandbox; ' : ''}default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`,
    )
    response.setHeader('Accept-Ranges', 'bytes')
    let start = 0,
      end = info.size - 1
    if (range && !download) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && !match[2])) throw new HttpError(416, 'Unsupported byte range')
      if (match[1]) {
        start = Number(match[1])
        if (match[2]) end = Math.min(Number(match[2]), end)
      } else start = Math.max(0, info.size - Number(match[2]))
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= info.size
      ) {
        response.setHeader('Content-Range', `bytes */${info.size}`)
        throw new HttpError(416, 'Byte range outside file')
      }
      response.statusCode = 206
      response.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`)
    }
    response.setHeader('Content-Length', Math.max(0, end - start + 1))
    await pipeline(
      handle.createReadStream({
        start,
        ...(info.size ? { end } : {}),
        autoClose: false,
      }),
      response,
    )
  } finally {
    await handle.close()
  }
}
