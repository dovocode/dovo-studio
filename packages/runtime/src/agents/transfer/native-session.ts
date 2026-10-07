import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path'
import { lstat, realpath, readdir, readFile, mkdir, open, link, unlink } from 'node:fs/promises'
import { Schema } from 'effect'
import { decode, mutableStruct, uuidSchema, type Agent, type NativeSession } from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import { exec, processEnvironment } from '../../process.js'
import { withCatalogRpc } from '../catalogs/rpc.js'

export const transferHash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex')
const FILE_LIMIT = 32 * 1024 * 1024
const recordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'
export function providerSessionRoot(agent: Agent) {
  const env = processEnvironment(agent.env)
  const home = env.HOME || homedir()
  return resolve(
    agent.provider === 'codex'
      ? env.CODEX_HOME || join(home, '.codex')
      : env.CLAUDE_CONFIG_DIR || join(home, '.claude'),
  )
}
function below(root: string, file: string) {
  const path = relative(root, file)
  if (!path || isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`))
    throw new HttpError(400, 'Session file is outside the provider session directory')
  return path
}
async function safeRead(root: string, file: string) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > FILE_LIMIT)
    throw new HttpError(413, 'Session contains an unsupported or oversized file')
  below(await realpath(root), await realpath(file))
  return readFile(file)
}
async function collect(root: string, directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (missing(error)) return []
    throw error
  }
  const paths: string[] = []
  for (const entry of entries) {
    const file = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new HttpError(400, 'Session symlinks cannot be transferred')
    if (entry.isDirectory()) paths.push(...(await collect(root, file)))
    else if (entry.isFile()) paths.push(file)
    if (paths.length > 1000) throw new HttpError(413, 'Session contains too many files')
  }
  return paths
}
async function codexThread(agent: Agent, sessionId: string, path?: string) {
  return withCatalogRpc(
    agent.endpoint || 'codex',
    ['app-server', '--listen', 'stdio://', ...(agent.args ?? [])],
    async (rpc) => {
      await rpc.sendRequest('initialize', {
        clientInfo: { name: 'dovo_transfer', version: '1' },
        capabilities: { experimentalApi: true },
      })
      await rpc.sendNotification('initialized', {})
      // Resume with an explicit imported rollout path asks Codex to rebuild its own index.
      // It loads context but never starts a turn or grants tool permissions.
      const result = await rpc.sendRequest(
        path ? 'thread/resume' : 'thread/read',
        path
          ? { threadId: sessionId, path, cwd: agent.env?.DOVO_TRANSFER_CWD }
          : { threadId: sessionId, includeTurns: true },
      )
      const thread = decode(
        mutableStruct({
          thread: mutableStruct({
            id: Schema.String,
            path: Schema.optional(Schema.NullOr(Schema.String)),
          }),
        }),
        result,
      ).thread
      if (thread.id !== sessionId) throw new HttpError(409, 'Provider loaded a different session')
      return thread
    },
    agent.env,
  )
}
async function version(agent: Agent) {
  const result = await exec(agent.endpoint || agent.provider, ['--version'], {
    env: processEnvironment(agent.env),
    timeout: 10000,
    maxBuffer: 4096,
  })
  return result.stdout.trim()
}
async function claudeFile(root: string, sessionId: string): Promise<string | undefined> {
  const projects = join(root, 'projects')
  const matches: string[] = []
  const entries = await readdir(projects, { withFileTypes: true }).catch((error) => {
    if (missing(error)) return []
    throw error
  })
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const path = join(projects, entry.name, `${sessionId}.jsonl`)
    try {
      await lstat(path)
      matches.push(path)
    } catch (error) {
      if (!missing(error)) throw error
    }
  }
  if (matches.length > 1) throw new HttpError(409, 'Native session is duplicated on this computer')
  return matches[0]
}
export async function exportNativeSession(agent: Agent, sessionId: string): Promise<NativeSession> {
  if (agent.provider !== 'codex' && agent.provider !== 'claude')
    throw new HttpError(
      409,
      'Native handoff supports Codex and Claude. Choose conversation replay for this provider.',
    )
  if (!sessionId)
    throw new HttpError(
      409,
      'This task has no native session. Run a turn or choose conversation replay.',
    )
  decode(uuidSchema, sessionId)
  const root = await realpath(providerSessionRoot(agent))
  let primary: string
  if (agent.provider === 'codex') {
    const thread = await codexThread(agent, sessionId)
    if (!thread.path || !thread.path.endsWith('.jsonl'))
      throw new HttpError(409, 'This Codex session has no transferable JSONL rollout')
    primary = thread.path
    const path = below(root, primary).split(sep).join('/')
    if (!path.startsWith('sessions/'))
      throw new HttpError(409, 'Unsupported Codex session location')
  } else {
    const file = await claudeFile(root, sessionId)
    if (!file) throw new HttpError(409, 'Native session is missing on this computer')
    primary = file
  }
  const paths = [
    primary,
    ...(agent.provider === 'claude' ? await collect(root, join(dirname(primary), sessionId)) : []),
  ]
  let total = 0
  const files: NativeSession['files'] = []
  for (const file of paths) {
    const bytes = await safeRead(root, file)
    total += bytes.length
    if (total > FILE_LIMIT)
      throw new HttpError(413, 'Native session exceeds the 32 MB transfer limit')
    files.push({
      path: below(root, file).split(sep).join('/'),
      data: bytes.toString('base64'),
      hash: transferHash(bytes),
    })
  }
  return { provider: agent.provider, sessionId, version: await version(agent), files }
}
function mapJsonl(
  data: Buffer,
  session: NativeSession,
  sourceDirectory: string,
  directory: string,
) {
  const text = data.toString('utf8')
  if (!Buffer.from(text).equals(data))
    throw new HttpError(400, 'Session transcript is not valid UTF-8')
  if (!text.endsWith('\n'))
    throw new HttpError(409, 'Session transcript has an incomplete final record')
  return text
    .split('\n')
    .map((line) => {
      if (!line) return line
      const record = decode(recordSchema, JSON.parse(line))
      if (session.provider === 'codex' && record.type === 'session_meta') {
        const payload = decode(recordSchema, record.payload)
        if (payload.id !== session.sessionId)
          throw new HttpError(409, 'Rollout session identity does not match')
        return JSON.stringify({ ...record, payload: { ...payload, cwd: directory } })
      }
      if (session.provider === 'claude' && record.cwd === sourceDirectory)
        return JSON.stringify({ ...record, cwd: directory })
      return line
    })
    .join('\n')
}
export async function importNativeSession(
  agent: Agent,
  session: NativeSession,
  sourceDirectory: string,
  directory: string,
  owned: readonly { path: string; hash: string }[] = [],
  plan: (files: Array<{ path: string; hash: string }>) => void = () => {},
) {
  if (session.provider !== agent.provider)
    throw new HttpError(409, 'Choose the same provider for native continuation')
  if ((await version(agent)) !== session.version)
    throw new HttpError(
      409,
      'Provider versions differ. Install the same version or explicitly choose conversation replay.',
    )
  const configuredRoot = providerSessionRoot(agent)
  await mkdir(configuredRoot, { recursive: true, mode: 0o700 })
  const root = await realpath(configuredRoot)
  const canonicalRoot = root
  const project = directory.replace(/[^a-zA-Z0-9]/g, '-')
  // Avoid guessing Claude's long-path hashing scheme.
  if (agent.provider === 'claude' && project.length > 200)
    throw new HttpError(409, 'Destination path is too long for native Claude handoff')
  const primary = session.files.find(
    (file) =>
      file.path.endsWith(`/${session.sessionId}.jsonl`) ||
      (session.provider === 'codex' && file.path.endsWith(`-${session.sessionId}.jsonl`)),
  )
  if (!primary) throw new HttpError(409, 'Native session is missing its primary transcript')
  if (agent.provider === 'codex') {
    for (const folder of ['sessions', 'archived_sessions']) {
      for (const file of await collect(root, join(root, folder)))
        if (
          file.endsWith(`-${session.sessionId}.jsonl`) &&
          !owned.some((item) => item.path === file)
        )
          throw new HttpError(409, 'This session already exists on the destination')
    }
  }
  if (agent.provider === 'claude') {
    if (!/^projects\/[^/]+\/[a-f0-9-]+\.jsonl$/.test(primary.path))
      throw new HttpError(400, 'Unsupported Claude transcript path')
    const existing = await claudeFile(root, session.sessionId)
    if (existing && !owned.some((item) => item.path === existing))
      throw new HttpError(409, 'This session already exists on the destination')
  }
  const writes: Array<{ file: string; data: Buffer; exists: boolean }> = []
  let total = 0
  for (const item of session.files) {
    if (
      item.path.includes('\\') ||
      item.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      isAbsolute(item.path)
    )
      throw new HttpError(400, 'Invalid native session path')
    const bytes = Buffer.from(item.data, 'base64')
    total += bytes.length
    if (total > FILE_LIMIT)
      throw new HttpError(413, 'Native session exceeds the 32 MB transfer limit')
    if (bytes.toString('base64') !== item.data || transferHash(bytes) !== item.hash)
      throw new HttpError(400, 'Native session checksum does not match')
    let path = item.path
    if (agent.provider === 'codex') {
      if (item !== primary || !/^sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-[^/]+\.jsonl$/.test(path))
        throw new HttpError(400, 'Unsupported Codex rollout path')
    } else {
      const prefix = primary.path.slice(0, primary.path.lastIndexOf('/') + 1)
      if (item !== primary && !path.startsWith(`${prefix}${session.sessionId}/`))
        throw new HttpError(400, 'Unsupported Claude session path')
      path = `projects/${project}/${path.slice(prefix.length)}`
    }
    const file = resolve(root, path)
    below(root, file)
    let data = item.path.endsWith('.jsonl')
      ? Buffer.from(mapJsonl(bytes, session, sourceDirectory, directory))
      : bytes
    let parent = canonicalRoot
    for (const part of relative(root, dirname(file)).split(sep).filter(Boolean)) {
      parent = join(parent, part)
      await mkdir(parent, { mode: 0o700 }).catch((error) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      })
      const info = await lstat(parent)
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new HttpError(400, 'Native session directories cannot be symlinks')
    }
    below(canonicalRoot, await realpath(dirname(file)))
    const present = await lstat(file).catch((error) => {
      if (missing(error)) return undefined
      throw error
    })
    if (present) {
      const previous = owned.find((item) => item.path === file)
      const current = await safeRead(root, file)
      const expectedHash = transferHash(data)
      let valid = current.equals(data)
      // Codex's own resume appends settings events while rebuilding its index. Accept only
      // these additions to our exact snapshot, including a crash before saving their new hash.
      if (!valid && agent.provider === 'codex' && current.subarray(0, data.length).equals(data)) {
        const suffix = current.subarray(data.length).toString('utf8')
        valid =
          suffix.endsWith('\n') &&
          suffix
            .trim()
            .split('\n')
            .every((line) => {
              const record = decode(recordSchema, JSON.parse(line))
              const payload = decode(recordSchema, record.payload)
              return (
                record.type === 'event_msg' &&
                payload.type === 'thread_settings_applied' &&
                payload.thread_id === session.sessionId
              )
            })
      }
      if (
        !previous ||
        !valid ||
        (previous.hash !== expectedHash && previous.hash !== transferHash(current))
      )
        throw new HttpError(409, 'Native session already exists on the destination')
      data = current
    }
    if (writes.some((item) => item.file === file))
      throw new HttpError(400, 'Duplicated native session path')
    writes.push({ file, data, exists: !!present })
  }
  const files = writes.map((item) => ({ path: item.file, hash: transferHash(item.data) }))
  // Persist ownership before writing so an interrupted import can safely resume its own files.
  plan(files)
  for (const item of writes)
    if (!item.exists) {
      const temporary = `${item.file}.${randomUUID()}.tmp`
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(item.data)
        await handle.sync()
        await handle.close()
        // A hard link publishes a complete file without replacing a concurrent import.
        await link(temporary, item.file)
      } finally {
        await handle.close()
        await unlink(temporary)
      }
    }
  const path = writes[session.files.indexOf(primary)]!.file
  if (agent.provider === 'codex')
    await codexThread(
      { ...agent, env: { ...agent.env, DOVO_TRANSFER_CWD: directory } },
      session.sessionId,
      path,
    )
  else {
    const script = `const { getSessionMessages } = await import(${JSON.stringify(import.meta.resolve('@anthropic-ai/claude-agent-sdk'))}); const messages = await getSessionMessages(process.argv[1], { dir: process.argv[2], includeSystemMessages: true }); if (!messages.length) throw new Error('Imported Claude context could not be loaded');`
    await exec(
      process.execPath,
      ['--input-type=module', '-e', script, session.sessionId, directory],
      {
        env: processEnvironment({ ...agent.env, CLAUDE_CONFIG_DIR: root }),
        timeout: 20000,
        maxBuffer: 4096,
      },
    )
  }
  const validated = await Promise.all(
    files.map(async (file) => ({ ...file, hash: transferHash(await safeRead(root, file.path)) })),
  )
  plan(validated)
  return validated
}

/** Only delete files published by this import whose bytes are still unchanged. */
export async function removeImportedSession(files: readonly { path: string; hash: string }[]) {
  for (const file of files) {
    const info = await lstat(file.path).catch((error) => {
      if (missing(error)) return undefined
      throw error
    })
    if (
      !info ||
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > FILE_LIMIT ||
      (await realpath(file.path)) !== file.path
    )
      continue
    if (transferHash(await readFile(file.path)) === file.hash) await unlink(file.path)
  }
}
