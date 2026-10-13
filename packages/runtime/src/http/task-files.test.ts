import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { decode, taskFileShareSchema } from '@dovo/protocol'
import { startRuntime } from '../index.js'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})
const token = 'file-preview-test-owner-at-least-32-characters'
async function setup() {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(runtime.close)
  const directory = await mkdtemp(join(tmpdir(), 'dovo-files-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: ['task', 'other'].map((id) => ({
      id,
      title: id,
      agentId: '',
      repositoryId: '',
      status: 'draft' as const,
      createdAt: '2026-10-10',
      messages: [],
      files: [],
      draft: '',
      example: false,
    })),
  }))
  vi.spyOn(runtime.services.checkouts, 'fileDirectory').mockResolvedValue(directory)
  vi.spyOn(runtime.services.checkouts, 'directory').mockRejectedValue(
    new Error('Previews must not prepare a checkout'),
  )
  const origin = `http://127.0.0.1:${runtime.port}`
  const share = (path: string, credential = token, taskId = 'task') =>
    fetch(`${origin}/api/tasks/files/share`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, path }),
    })
  return { runtime, directory, origin, share }
}
it('previews before download, preserves exact bytes, and requires a scoped expiring grant', async () => {
  const { directory, origin, share } = await setup()
  await writeFile(join(directory, 'a b.html'), '<h1>Preview</h1><script>alert(1)</script>')
  expect((await share('a%20b.html:12', 'wrong')).status).toBe(401)
  const result = await share('a%20b.html:12')
  expect(result.status).toBe(200)
  const { url } = decode(taskFileShareSchema, await result.json())
  expect(url).not.toContain(token)
  const page = await fetch(origin + url)
  expect(page.headers.get('cache-control')).toBe('no-store')
  const html = await page.text()
  expect(html).toContain('<iframe sandbox')
  expect(html).toContain('Download original')
  expect(html).not.toContain('<script>')
  const content = await fetch(origin + url + '?content=1')
  expect(content.headers.get('content-security-policy')).toContain('sandbox;')
  expect(await content.text()).toBe('<h1>Preview</h1><script>alert(1)</script>')
  const download = await fetch(origin + url + '?download=1')
  expect(download.headers.get('content-disposition')).toContain('attachment;')
  expect(download.headers.get('content-disposition')).toContain('a%20b.html')
  expect(await download.text()).toBe('<h1>Preview</h1><script>alert(1)</script>')
  expect((await fetch(`${origin}/api/tasks/files/shared/invalid`)).status).toBe(401)
  const now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 16 * 60_000)
  expect((await fetch(origin + url)).status).toBe(401)
  clock.mockRestore()
})
it('allows assistant-shared outside files but denies other threads, user links and escaping symlinks', async () => {
  const { runtime, directory, origin, share } = await setup()
  const outside = await mkdtemp(join(tmpdir(), 'dovo-shared-files-'))
  cleanup.push(() => rm(outside, { recursive: true, force: true }))
  const path = join(outside, 'result.txt')
  await writeFile(path, 'shared output')
  await symlink(path, join(directory, 'escape.txt'))
  expect((await share('escape.txt')).status).toBe(400)
  expect((await share(path)).status).toBe(403)
  runtime.services.store.updateTaskHistory('task', (task) => ({
    ...task,
    messages: [{ id: 'user', role: 'user', text: `[Result](<${path}>)` }],
  }))
  expect((await share(path)).status).toBe(403)
  runtime.services.store.updateTaskHistory('task', (task) => ({
    ...task,
    messages: [
      { id: 'assistant', role: 'assistant', text: `[Result][output]\n\n[output]: <${path}:4>` },
    ],
  }))
  expect((await share(path, token, 'other')).status).toBe(403)
  const { url } = decode(taskFileShareSchema, await (await share(path)).json())
  expect(await (await fetch(origin + url + '?content=1')).text()).toBe('shared output')
  // Grants revalidate current thread sharing rather than retaining access after a link is removed.
  runtime.services.store.updateTaskHistory('task', (task) => ({ ...task, messages: [] }))
  expect((await fetch(origin + url)).status).toBe(403)
})
it('offers download when a binary file cannot be previewed', async () => {
  const { directory, origin, share } = await setup()
  const bytes = Buffer.from([0, 1, 2, 255])
  await writeFile(join(directory, 'archive.bin'), bytes)
  const { url } = decode(taskFileShareSchema, await (await share('archive.bin')).json())
  expect(await (await fetch(origin + url)).text()).toContain('no browser preview')
  expect(Buffer.from(await (await fetch(origin + url + '?download=1')).arrayBuffer())).toEqual(
    bytes,
  )
})

it('revokes file grants when their paired device is revoked and reports missing files', async () => {
  const { runtime, directory, origin, share } = await setup()
  await writeFile(join(directory, 'readme.md'), '# Shared text')
  const credential = 'paired-file-preview-token-at-least-32-characters'
  const device = runtime.services.devices.add('Mobile', credential)
  const { url } = decode(taskFileShareSchema, await (await share('readme.md', credential)).json())
  expect((await fetch(origin + url)).status).toBe(200)
  runtime.services.devices.revoke(device)
  expect((await fetch(origin + url)).status).toBe(401)
  expect((await share('missing.txt')).status).toBe(404)
  expect((await share('https://example.com/file.txt')).status).toBe(400)
  expect((await share('file:///etc/hosts')).status).toBe(403)
})

it('previews UTF-8 text when the bounded MIME sample ends inside a multibyte character', async () => {
  const { directory, origin, share } = await setup()
  const contents = 'a'.repeat(8191) + '😀 unicode source'
  await writeFile(join(directory, 'unicode.txt'), contents)
  const { url } = decode(taskFileShareSchema, await (await share('unicode.txt')).json())
  expect(await (await fetch(origin + url)).text()).toContain('title="File preview"')
  expect(await (await fetch(origin + url + '?content=1')).text()).toBe(contents)
})

it('supports byte ranges for media without exposing unauthorized files', async () => {
  const { directory, origin, share } = await setup()
  const data = Buffer.from('0123456789')
  await writeFile(join(directory, 'clip.bin'), data)
  const { url } = decode(taskFileShareSchema, await (await share('clip.bin')).json())
  const part = await fetch(origin + url + '?content=1', { headers: { Range: 'bytes=2-5' } })
  expect(part.status).toBe(206)
  expect(part.headers.get('content-range')).toBe('bytes 2-5/10')
  expect(await part.text()).toBe('2345')
  const suffix = await fetch(origin + url + '?content=1', { headers: { Range: 'bytes=-3' } })
  expect(await suffix.text()).toBe('789')
  expect(
    (await fetch(origin + url + '?content=1', { headers: { Range: 'bytes=100-200' } })).status,
  ).toBe(416)
  expect(
    (await fetch(origin + url + '?content=1', { headers: { Range: 'bytes=0-1,5-6' } })).status,
  ).toBe(416)
  expect(
    await (await fetch(origin + url + '?download=1', { headers: { Range: 'bytes=0-1' } })).text(),
  ).toBe(data.toString())
})
it('opens authorized files on the runtime without preparing a checkout', async () => {
  const { runtime, directory, origin } = await setup()
  await writeFile(join(directory, 'app.ts'), 'const x = 1')
  const open = vi.spyOn(runtime.services.git, 'openFile').mockResolvedValue()
  const launch = (path: string, target = 'vscode', credential = token) =>
    fetch(origin + '/api/tasks/files/open', {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'task', path, target }),
    })
  expect((await launch('app.ts')).status).toBe(200)
  expect(open).toHaveBeenCalledWith(join(directory, 'app.ts'), 'vscode')
  expect((await launch('/etc/hosts')).status).toBe(403)
  expect((await launch('app.ts', 'unknown')).status).toBe(400)
  expect((await launch('app.ts', 'vscode', 'wrong')).status).toBe(401)
  expect(open).toHaveBeenCalledTimes(1)
})
it('allows outside files explicitly shared through Codex file citations', async () => {
  const { runtime, share } = await setup()
  const outside = await mkdtemp(join(tmpdir(), 'dovo-citation-'))
  cleanup.push(() => rm(outside, { recursive: true, force: true }))
  const path = join(outside, 'result.ts')
  await writeFile(path, 'export const result = 1')
  runtime.services.store.updateTaskHistory('task', (task) => ({
    ...task,
    messages: [
      {
        id: 'reply',
        role: 'assistant',
        text: `See :codex-file-citation{path="${path}" line_range_start="1"}.`,
      },
    ],
  }))
  expect((await share(path)).status).toBe(200)
  expect((await share(path, token, 'other')).status).toBe(403)
})
it('serves a local PDF viewer and worker only through a valid file grant', async () => {
  const { directory, origin, share } = await setup()
  await writeFile(join(directory, 'report.pdf'), '%PDF-1.7\n')
  const { url } = decode(taskFileShareSchema, await (await share('report.pdf')).json())
  const page = await fetch(origin + url)
  const html = await page.text()
  expect(html).toContain('PDF pages')
  expect(html).toContain('isEvalSupported: false')
  expect(page.headers.get('content-security-policy')).toContain('script-src')
  const script = await fetch(origin + url + '?pdfjs=main')
  expect(script.status).toBe(200)
  expect(script.headers.get('content-type')).toBe('text/javascript')
  expect((await script.text()).length).toBeGreaterThan(1000)
  expect((await fetch(origin + url + '?pdfasset=../package.json')).status).toBe(400)
  expect((await fetch(origin + url + '?pdfjs=other')).status).toBe(400)
  expect((await fetch(origin + '/api/tasks/files/shared/wrong?pdfjs=main')).status).toBe(401)
})
it('loads HTML visualizations from their runtime with task-scoped authorization and size limits', async () => {
  const { runtime, directory, origin } = await setup()
  const external = await mkdtemp(join(tmpdir(), 'dovo-visualization-'))
  cleanup.push(() => rm(external, { recursive: true, force: true }))
  const path = join(external, 'demo.html')
  await writeFile(path, '<button onclick="this.textContent=123">Interactive</button>')
  runtime.services.store.updateTaskHistory('task', (task) => ({
    ...task,
    messages: [
      {
        id: 'reply',
        role: 'assistant',
        text: `\uE200visualize\uE202${JSON.stringify({ path })}\uE201`,
        createdAt: '2026-10-12',
      },
    ],
  }))
  const read = (file: string, taskId = 'task', credential = token) =>
    fetch(origin + '/api/tasks/visualizations/read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, path: file }),
    })
  expect((await read(path, 'task', 'wrong')).status).toBe(401)
  expect((await read(path, 'other')).status).toBe(403)
  const response = await read(path)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    path,
    contents: '<button onclick="this.textContent=123">Interactive</button>',
  })
  const large = join(directory, 'large.html')
  const contents = '<h1>Large visualization</h1>'.padEnd(100 * 1024 * 1024, ' ')
  await writeFile(large, contents)
  const largeResponse = await read(large)
  expect(largeResponse.status).toBe(200)
  expect(await largeResponse.json()).toEqual({ path: large, contents })
  await writeFile(large, contents + ' ')
  const oversizedResponse = await read(large)
  expect(oversizedResponse.status).toBe(413)
  expect(await oversizedResponse.text()).toContain('up to 100 MB')
  const text = join(directory, 'note.txt')
  await writeFile(text, 'not html')
  expect((await read(text)).status).toBe(415)
  const binary = join(directory, 'binary.html')
  await writeFile(binary, '<html>\0</html>')
  expect((await read(binary)).status).toBe(415)
})
