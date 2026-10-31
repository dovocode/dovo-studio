import { isAbsolute, join, relative, resolve } from 'node:path'
import { constants, type Dirent, type Stats } from 'node:fs'
import { opendir, lstat, open, realpath } from 'node:fs/promises'
import type { ProjectDirectory, ProjectContentSearch } from '@dovo/protocol'
import type { GitService } from '../git/git.js'
import { ProcessError } from '../../process.js'
import { HttpError } from '../../errors.js'
import { safeFile } from './paths.js'

const PAGE_SIZE = 200
const FILESYSTEM_BATCH_SIZE = 32
const DIRECTORY_LIMIT = 10_000
const MAX_FILES = 2_000
const MAX_BYTES = 16 * 1024 * 1024
const MAX_FILE_BYTES = 1024 * 1024
const MAX_MATCHES = 200
const SEARCH_MS = 2_000
const skipName = (name: string, plain: boolean) =>
  name === '.git' || (plain && name === 'node_modules')

/** Reads only visited directories; global composer path suggestions keep their existing cache. */
export class ProjectBrowser {
  constructor(private git: GitService) {}
  private async visible(
    cwd: string,
    paths: string[],
    plain: boolean,
    signal?: AbortSignal,
    deadline?: number,
  ) {
    signal?.throwIfAborted()
    if (plain || !paths.length) return new Set(paths)
    const limits = () => ({
      signal,
      timeout: Math.max(1, Math.min(5_000, (deadline ?? Date.now() + 5_000) - Date.now())),
      maxBuffer: 2 * 1024 * 1024,
    })
    let ignored: string[]
    try {
      ignored = (
        await this.git.readCommand(cwd, ['check-ignore', '-z', '--stdin'], {
          ...limits(),
          input: `${paths.join('\0')}\0`,
        })
      )
        .split('\0')
        .filter(Boolean)
    } catch (error) {
      if (error instanceof ProcessError && error.code === 1) ignored = []
      else throw error
    }
    const hidden = new Set(ignored)
    // A tracked file remains discoverable even if its parent later becomes ignored.
    if (ignored.length) {
      const tracked = (
        await this.git.readCommand(
          cwd,
          ['--literal-pathspecs', 'ls-files', '--cached', '-z', '--', ...ignored],
          limits(),
        )
      )
        .split('\0')
        .filter(Boolean)
      for (const path of ignored) {
        if (tracked.some((file) => file === path || file.startsWith(`${path}/`)))
          hidden.delete(path)
      }
    }
    return new Set(paths.filter((path) => !hidden.has(path)))
  }
  private async containedTarget(root: string, path: string) {
    const actual = await realpath(await safeFile(root, path))
    const rel = relative(root, actual)
    // A link may change between safeFile's check and this realpath call.
    if (
      rel === '..' ||
      rel.startsWith('../') ||
      rel.startsWith('..\\') ||
      isAbsolute(rel) ||
      rel.split(/[\\/]/).includes('.git')
    )
      throw new HttpError(400, 'File is outside the browsable project')
    return actual
  }
  private async browseTarget(root: string, path: string) {
    const full = path ? await safeFile(root, path) : root
    const ancestors = new Set([root])
    const ignorePaths: string[] = []
    let prefix = ''
    let linked = false
    for (const part of relative(root, resolve(full)).split(/[\\/]/).filter(Boolean)) {
      prefix = prefix ? `${prefix}/${part}` : part
      const lexical = await safeFile(root, prefix)
      if (!linked) ignorePaths.push(prefix)
      const actual = await this.containedTarget(root, prefix)
      linked ||= actual !== lexical
      if (ancestors.has(actual)) throw new HttpError(400, 'Directory link creates a cycle')
      ancestors.add(actual)
    }
    return { target: path ? await this.containedTarget(root, path) : root, ancestors, ignorePaths }
  }
  async directory(
    cwd: string,
    directory = '',
    cursor?: string,
    plain = false,
    signal?: AbortSignal,
  ): Promise<ProjectDirectory> {
    const root = await realpath(cwd)
    const { target, ancestors, ignorePaths } = await this.browseTarget(root, directory)
    const info = await lstat(target)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new HttpError(400, 'Choose a directory')
    const version = `${info.dev}-${info.ino}-${info.mtimeMs}-${info.ctimeMs}`
    const [savedVersion, savedOffset] = cursor?.split(':') ?? []
    const offset = savedOffset === undefined ? 0 : Number(savedOffset)
    if (
      cursor &&
      (savedVersion !== version ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > DIRECTORY_LIMIT)
    )
      throw new HttpError(409, 'This directory changed. Refresh its listing.')
    const entries: ProjectDirectory['entries'] = []
    const targets = new Map<
      string,
      {
        target: string
        link?: { source: string; dev: number; ino: number; kind: string }
      }
    >()
    let scanned = 0,
      more = false
    const inspectEntry = async (
      entry: Dirent,
    ): Promise<ProjectDirectory['entries'][number] | undefined> => {
      if (skipName(entry.name, plain)) return
      const path = directory ? `${directory}/${entry.name}` : entry.name
      // This metadata-only listing can trust ordinary dirent kinds: replacing an
      // entry changes the parent timestamps checked below. File opens validate separately.
      const source = join(target, entry.name)
      try {
        let details: Dirent | Stats = entry
        if (!entry.isFile() && !entry.isDirectory() && !entry.isSymbolicLink())
          details = await lstat(source)
        const link = details.isSymbolicLink()
        const actual = link ? await this.containedTarget(root, relative(root, source)) : source
        let identity: { dev: number; ino: number } | undefined
        if (link) {
          const linked = await lstat(actual)
          identity = { dev: linked.dev, ino: linked.ino }
          details = linked
        }
        if ((!details.isDirectory() && !details.isFile()) || ancestors.has(actual)) return
        const canonicalPath = relative(root, actual).replaceAll('\\', '/')
        if (canonicalPath.split('/').some((name) => skipName(name, plain))) return
        const kind = details.isDirectory() ? 'directory' : 'file'
        targets.set(path, {
          target: canonicalPath,
          ...(identity ? { link: { source, ...identity, kind } } : {}),
        })
        return { path, kind }
      } catch (error) {
        signal?.throwIfAborted()
        if (error instanceof HttpError && error.status === 400) return
        if (
          error instanceof Error &&
          'code' in error &&
          ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(error.code))
        )
          return
        throw error
      }
    }
    const handle = await opendir(target)
    try {
      let ended = false
      while (!ended) {
        signal?.throwIfAborted()
        const batch: Dirent[] = []
        const count = Math.max(1, Math.min(FILESYSTEM_BATCH_SIZE, PAGE_SIZE - entries.length))
        for (let at = 0; at < count; at++) {
          const entry = await handle.read()
          if (!entry) {
            ended = true
            break
          }
          if (scanned++ < offset) continue
          if (scanned > DIRECTORY_LIMIT || entries.length === PAGE_SIZE) {
            more = true
            scanned--
            ended = true
            break
          }
          batch.push(entry)
        }
        const results = await Promise.all(batch.map(inspectEntry))
        for (const entry of results) if (entry) entries.push(entry)
      }
    } finally {
      await handle.close()
    }
    const visible = await this.visible(
      root,
      directory && target !== resolve(root, directory)
        ? ignorePaths
        : entries.map((entry) => entry.path),
      plain,
      signal,
    )
    const aliases = [...targets.values()]
      .map((value) => value.target)
      .filter((path) => target !== resolve(root, directory || '.') || !targets.has(path))
    const visibleTargets = await this.visible(root, aliases, plain, signal)
    // Bound revalidation too; link-heavy pages must not launch hundreds of resolutions.
    const links = [...targets.values()].flatMap(({ target, link }) =>
      link ? [{ target, ...link }] : [],
    )
    for (let at = 0; at < links.length; at += FILESYSTEM_BATCH_SIZE) {
      signal?.throwIfAborted()
      await Promise.all(
        links.slice(at, at + FILESYSTEM_BATCH_SIZE).map(async (saved) => {
          const actual = await this.containedTarget(root, relative(root, saved.source))
          const details = await lstat(actual)
          if (
            relative(root, actual).replaceAll('\\', '/') !== saved.target ||
            details.dev !== saved.dev ||
            details.ino !== saved.ino ||
            (saved.kind === 'directory' ? !details.isDirectory() : !details.isFile())
          )
            throw new HttpError(409, 'This directory changed. Refresh its listing.')
        }),
      )
    }
    // Directory aliases remain mutable even when all their children are ordinary files.
    const resolved = await this.browseTarget(root, directory)
    const current = await lstat(target)
    if (
      resolved.target !== target ||
      current.dev !== info.dev ||
      current.ino !== info.ino ||
      current.mtimeMs !== info.mtimeMs ||
      current.ctimeMs !== info.ctimeMs
    )
      throw new HttpError(409, 'This directory changed. Refresh its listing.')
    return {
      entries: entries
        .filter(
          (entry) =>
            (target !== resolve(root, directory || '.')
              ? ignorePaths.every((path) => visible.has(path))
              : visible.has(entry.path)) &&
            (visible.has(targets.get(entry.path)!.target) ||
              visibleTargets.has(targets.get(entry.path)!.target)),
        )
        .sort((a, b) =>
          a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'directory' ? -1 : 1,
        ),
      ...(more && scanned < DIRECTORY_LIMIT ? { nextCursor: `${version}:${scanned}` } : {}),
      truncated: more && scanned >= DIRECTORY_LIMIT,
    }
  }
  async search(
    cwd: string,
    query: string,
    plain = false,
    signal?: AbortSignal,
  ): Promise<ProjectContentSearch> {
    if (!query || query.includes('\n') || query.includes('\r') || query.length > 256)
      throw new HttpError(400, 'Enter a single-line search of 1–256 characters')
    const root = await realpath(cwd)
    const result: ProjectContentSearch = {
      matches: [],
      truncated: false,
      scannedFiles: 0,
      skippedFiles: 0,
    }
    const deadline = Date.now() + SEARCH_MS
    const directories = ['']
    let totalBytes = 0,
      visited = 0
    const needle = query
    const expired = () =>
      Date.now() >= deadline ||
      result.scannedFiles >= MAX_FILES ||
      totalBytes >= MAX_BYTES ||
      result.matches.length >= MAX_MATCHES ||
      visited >= DIRECTORY_LIMIT
    const skipDisappeared = (error: unknown) => {
      signal?.throwIfAborted()
      if (
        !(
          error instanceof Error &&
          'code' in error &&
          (error.code === 'ENOENT' || error.code === 'ENOTDIR')
        )
      )
        throw error
      result.skippedFiles++
      result.truncated = true
    }
    while (directories.length) {
      signal?.throwIfAborted()
      if (expired()) {
        result.truncated = true
        break
      }
      const directory = directories.shift()!
      try {
        const target = directory ? await safeFile(root, directory) : root
        const info = await lstat(target)
        if (!info.isDirectory() || info.isSymbolicLink()) {
          result.skippedFiles++
          result.truncated = true
          continue
        }
        const handle = await opendir(target)
        try {
          while (true) {
            signal?.throwIfAborted()
            if (expired()) {
              result.truncated = true
              break
            }
            const batch: { path: string; directory: boolean }[] = []
            let ended = false
            for (let at = 0; at < PAGE_SIZE; at++) {
              const entry = await handle.read()
              if (!entry) {
                ended = true
                break
              }
              visited++
              if (skipName(entry.name, plain) || (!entry.isDirectory() && !entry.isFile())) continue
              batch.push({
                path: directory ? `${directory}/${entry.name}` : entry.name,
                directory: entry.isDirectory(),
              })
            }
            let visible: Set<string>
            try {
              visible = await this.visible(
                root,
                batch.map((entry) => entry.path),
                plain,
                signal,
                deadline,
              )
            } catch (error) {
              signal?.throwIfAborted()
              if (Date.now() >= deadline) {
                result.truncated = true
                break
              }
              throw error
            }
            for (const entry of batch) {
              signal?.throwIfAborted()
              if (expired()) {
                result.truncated = true
                break
              }
              if (!visible.has(entry.path)) continue
              if (entry.directory) {
                directories.push(entry.path)
                continue
              }
              try {
                const filename = await safeFile(root, entry.path)
                const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
                try {
                  const details = await file.stat()
                  if (
                    !details.isFile() ||
                    details.size > MAX_FILE_BYTES ||
                    totalBytes + details.size > MAX_BYTES
                  ) {
                    result.skippedFiles++
                    result.truncated = true
                    continue
                  }
                  const bytes = Buffer.alloc(details.size)
                  let read = 0
                  while (read < bytes.length) {
                    signal?.throwIfAborted()
                    const part = await file.read(bytes, read, bytes.length - read, read)
                    if (!part.bytesRead) break
                    read += part.bytesRead
                  }
                  totalBytes += read
                  result.scannedFiles++
                  const content = bytes.subarray(0, read)
                  if (content.includes(0)) continue
                  let text: string
                  try {
                    text = new TextDecoder('utf-8', { fatal: true }).decode(content)
                  } catch {
                    continue
                  }
                  const lines = text.split('\n')
                  for (let at = 0; at < lines.length; at++) {
                    const line = lines[at].replace(/\r$/, '')
                    const found = line.indexOf(needle)
                    if (found < 0) continue
                    const start = Math.max(0, found - 120)
                    const excerpt = line.slice(start, Math.max(found + query.length, start + 512))
                    result.matches.push({
                      path: entry.path,
                      line: at + 1,
                      excerpt,
                      matchStart: found - start,
                      matchEnd: found - start + query.length,
                    })
                    if (result.matches.length === MAX_MATCHES) {
                      result.truncated = true
                      break
                    }
                  }
                } finally {
                  await file.close()
                }
              } catch (error) {
                skipDisappeared(error)
              }
            }
            if (ended) break
          }
        } finally {
          await handle.close()
        }
      } catch (error) {
        skipDisappeared(error)
      }
    }
    return result
  }
}
