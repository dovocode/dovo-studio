import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import {
  ARTIFACT_FEED_MAX_BYTES,
  SCRATCH_PROJECT_ID,
  artifactFeedSelect,
  type StudioDataSource,
} from '@dovo/protocol'
import { HttpError, errorMessage } from '../errors.js'
import { processEnvironment } from '../process.js'
import { commandCheckLaunch } from '../terminal/shell.js'
import { stopOwnedChild } from '../agents/execution/stop-owned-child.js'
import { repositoryPath } from '../scm/repositories/paths.js'
import type { Services } from '../services.js'

const MAX_RESPONSE_BYTES = 1024 * 1024
const API_TIMEOUT_MS = 15_000
const CLI_TIMEOUT_MS = 15_000

export type DataSourceDirectory = (id: string, authorize: () => void) => Promise<string>

export function studioDataDirectory(store: Pick<Services['store'], 'get'>): DataSourceDirectory {
  return async (id, authorize) => {
    const find = () => store.get().repositories.find((item) => item.id === id)
    const project = find()
    if (!project && id !== SCRATCH_PROJECT_ID) throw new HttpError(404, 'Project not found')
    const cwd = await repositoryPath(
      project?.kind === 'scratch' ? homedir() : (project?.path ?? homedir()),
    )
    authorize()
    if (find()?.path !== project?.path || find()?.kind !== project?.kind)
      throw new HttpError(409, 'The project changed. Reload it before running the command.')
    return cwd
  }
}

function select(value: unknown, pointer: string) {
  let data: unknown
  try {
    data = artifactFeedSelect(value, pointer)
  } catch (error) {
    throw new HttpError(422, errorMessage(error))
  }
  const encoded = JSON.stringify(data)
  if (encoded === undefined || Buffer.byteLength(encoded) > ARTIFACT_FEED_MAX_BYTES)
    throw new HttpError(413, 'Select a JSON field smaller than 256 KB')
  return JSON.parse(encoded) as unknown
}

/** Fetches exactly the saved URL. No redirects, cookies or dashboard-provided headers. */
async function readApi(url: string, signal: AbortSignal) {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(API_TIMEOUT_MS)]),
    })
  } catch (error) {
    signal.throwIfAborted()
    throw new HttpError(
      502,
      error instanceof Error && error.name === 'TimeoutError'
        ? 'The API did not answer within 15 seconds'
        : 'The API request failed. Redirects are not followed.',
    )
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new HttpError(502, `The API answered with HTTP ${response.status}`)
  }
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new HttpError(413, 'The API response is larger than 1 MB')
  }
  const chunks: Uint8Array[] = []
  const reader = response.body?.getReader()
  let size = 0
  try {
    for (;;) {
      if (!reader) break
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES)
        throw new HttpError(413, 'The API response is larger than 1 MB')
      chunks.push(value)
    }
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof HttpError) throw error
    throw new HttpError(502, 'The API response stopped before it was complete')
  } finally {
    await reader?.cancel().catch(() => undefined)
  }
  return parseOutput(Buffer.concat(chunks).toString('utf8'))
}

function parseOutput(text: string) {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

async function readCli(command: string, cwd: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const launch = commandCheckLaunch(command)
  const child = spawn(launch.command, launch.args, {
    cwd,
    env: processEnvironment(launch.env),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  const chunks: Buffer[] = []
  let size = 0
  let failure: unknown
  let shutdown: Promise<void> | undefined
  let rejectShutdown!: (cause: unknown) => void
  const failed = new Promise<never>((_, reject) => {
    rejectShutdown = reject
  })
  const stop = () => {
    shutdown ??= stopOwnedChild(child)
    void shutdown.catch(rejectShutdown)
  }
  const abort = () => {
    failure ??= signal.reason
    stop()
  }
  const timer = setTimeout(() => {
    failure ??= new HttpError(504, 'The command did not finish within 15 seconds')
    stop()
  }, CLI_TIMEOUT_MS)
  const collect = (chunk: Buffer, stdout: boolean) => {
    size += chunk.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      failure ??= new HttpError(413, 'The command output is larger than 1 MB')
      stop()
    } else if (stdout) chunks.push(chunk)
  }
  child.stdout.on('data', (chunk: Buffer) => collect(chunk, true))
  child.stderr.on('data', (chunk: Buffer) => collect(chunk, false))
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', () => reject(new HttpError(502, 'The command could not start')))
    child.once('close', resolve)
  })
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  try {
    const code = await Promise.race([closed, failed])
    if (failure) throw failure
    if (code !== 0)
      throw new HttpError(
        502,
        code === null ? 'The command stopped' : `The command exited with code ${code}`,
      )
    return parseOutput(Buffer.concat(chunks).toString('utf8'))
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    try {
      await (shutdown ?? stopOwnedChild(child))
    } catch {
      child.stdout.destroy()
      child.stderr.destroy()
      throw new HttpError(502, 'The command did not shut down cleanly')
    }
  }
}

export async function readStudioData(
  source: StudioDataSource,
  signal: AbortSignal,
  authorize: () => void,
  directory?: DataSourceDirectory,
) {
  authorize()
  if (source.kind === 'api') return select(await readApi(source.url, signal), source.pointer)
  if (!directory) throw new HttpError(403, 'A paired client must start this command')
  const cwd = await directory(source.repositoryId, authorize)
  authorize()
  return select(await readCli(source.command, cwd, signal), source.pointer)
}
