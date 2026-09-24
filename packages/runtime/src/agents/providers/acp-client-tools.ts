import { spawn, type ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, dirname, basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Client, ClientCapabilities, TerminalExitStatus } from '@agentclientprotocol/sdk'
import type { AgentRun } from '../types.js'
import { processEnvironment } from '../../process.js'
import { stopAcpChild } from './acp-process.js'

type Terminal = {
  child: ChildProcess
  output: string
  truncated: boolean
  byteLimit: number
  exit: Promise<TerminalExitStatus>
  status?: TerminalExitStatus
}

function inside(root: string, path: string) {
  const rel = relative(root, path)
  return (
    rel === '' ||
    (rel !== '..' &&
      !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      !isAbsolute(rel))
  )
}

export async function acpClientTools(run: AgentRun, session: () => string | undefined) {
  const root = await realpath(run.cwd)
  const terminals = new Map<string, Terminal>()
  const toolsAllowed = run.tools !== 'none'
  const canWrite = toolsAllowed && run.agent.permission !== 'read-only'
  const canUseTerminal = canWrite

  async function checkedPath(path: string, writing = false) {
    if (!isAbsolute(path)) throw new Error('ACP file path must be absolute')
    const target = resolve(path)
    const actual = await realpath(writing ? dirname(target) : target)
    if (!inside(root, actual)) throw new Error('ACP file path resolves outside the workspace')
    return writing ? join(actual, basename(target)) : actual
  }

  function checkSession(id: string) {
    if (id !== session()) throw new Error('ACP session does not match this task')
    if (run.signal.aborted) throw new Error('Task cancelled')
  }

  function getTerminal(id: string) {
    const terminal = terminals.get(id)
    if (!terminal) throw new Error('ACP terminal is unavailable')
    return terminal
  }

  const client: Pick<
    Client,
    | 'readTextFile'
    | 'writeTextFile'
    | 'createTerminal'
    | 'terminalOutput'
    | 'waitForTerminalExit'
    | 'killTerminal'
    | 'releaseTerminal'
  > = {
    readTextFile: toolsAllowed
      ? async (params) => {
          checkSession(params.sessionId)
          const file = await checkedPath(params.path)
          const handle = await open(
            file,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          )
          let content: string
          try {
            const info = await handle.stat()
            if (!info.isFile()) throw new Error('ACP file is not a regular file')
            if (info.size > 4 * 1024 * 1024) throw new Error('ACP file exceeds the 4 MB read limit')
            content = await handle.readFile({ encoding: 'utf8' })
          } finally {
            await handle.close()
          }
          if (params.line == null && params.limit == null) return { content }
          const lines = content.split('\n')
          const start = Math.max(0, (params.line ?? 1) - 1)
          return {
            content: lines
              .slice(start, params.limit == null ? undefined : start + params.limit)
              .join('\n'),
          }
        }
      : undefined,
    writeTextFile: canWrite
      ? async (params) => {
          checkSession(params.sessionId)
          const file = await checkedPath(params.path, true)
          if (Buffer.byteLength(params.content) > 4 * 1024 * 1024)
            throw new Error('ACP file exceeds the 4 MB write limit')
          if (!(await run.approve('ACP write file', file)))
            throw new Error('ACP file write declined')
          checkSession(params.sessionId)
          const safeFile = await checkedPath(params.path, true)
          const existing = await lstat(safeFile).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return undefined
            throw error
          })
          if (existing?.isSymbolicLink()) throw new Error('ACP file is a symbolic link')
          const handle = await open(
            safeFile,
            constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
            0o600,
          )
          try {
            const info = await handle.stat()
            if (!info.isFile() || info.nlink !== 1)
              throw new Error('ACP file is not a regular file')
            await handle.truncate(0)
            await handle.writeFile(params.content)
          } finally {
            await handle.close()
          }
        }
      : undefined,
    createTerminal: canUseTerminal
      ? async (params) => {
          checkSession(params.sessionId)
          if (terminals.size >= 8) throw new Error('ACP terminal limit reached')
          const byteLimit = Math.min(
            Math.max(params.outputByteLimit ?? 1024 * 1024, 1),
            4 * 1024 * 1024,
          )
          if (params.cwd) await checkedPath(params.cwd)
          if (
            !(await run.approve(
              'ACP run command',
              [params.command, ...(params.args ?? [])].join(' '),
            ))
          )
            throw new Error('ACP terminal declined')
          checkSession(params.sessionId)
          const safeCwd = params.cwd ? await checkedPath(params.cwd) : root
          const env = {
            ...processEnvironment(),
            ...Object.fromEntries((params.env ?? []).map(({ name, value }) => [name, value])),
          }
          delete env.DOVO_OWNER_TOKEN
          delete env.ELECTRON_RUN_AS_NODE
          const child = spawn(params.command, params.args ?? [], {
            cwd: safeCwd,
            env,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          const id = randomUUID()
          const terminal: Terminal = {
            child,
            output: '',
            truncated: false,
            byteLimit,
            exit: Promise.resolve({}),
          }
          const append = (chunk: Buffer) => {
            terminal.output += chunk.toString('utf8')
            const bytes = Buffer.byteLength(terminal.output)
            if (bytes > terminal.byteLimit) {
              terminal.output = Buffer.from(terminal.output)
                .subarray(bytes - terminal.byteLimit)
                .toString('utf8')
                .replace(/^\uFFFD+/, '')
              terminal.truncated = true
            }
          }
          child.stdout.on('data', append)
          child.stderr.on('data', append)
          terminal.exit = new Promise((resolveExit, reject) => {
            child.once('error', reject)
            child.once('exit', (code, signal) => {
              terminal.status = { exitCode: code, signal: signal ?? undefined }
              resolveExit(terminal.status)
            })
          })
          void terminal.exit.catch(() => {})
          terminals.set(id, terminal)
          return { terminalId: id }
        }
      : undefined,
    terminalOutput: canUseTerminal
      ? (params) => {
          checkSession(params.sessionId)
          const terminal = getTerminal(params.terminalId)
          return {
            output: terminal.output,
            truncated: terminal.truncated,
            exitStatus: terminal.status,
          }
        }
      : undefined,
    waitForTerminalExit: canUseTerminal
      ? async (params) => {
          checkSession(params.sessionId)
          const terminal = getTerminal(params.terminalId)
          return terminal.exit
        }
      : undefined,
    killTerminal: canUseTerminal
      ? (params) => {
          checkSession(params.sessionId)
          return stopAcpChild(getTerminal(params.terminalId).child)
        }
      : undefined,
    releaseTerminal: canUseTerminal
      ? async (params) => {
          checkSession(params.sessionId)
          await stopAcpChild(getTerminal(params.terminalId).child)
          terminals.delete(params.terminalId)
        }
      : undefined,
  }
  const capabilities: ClientCapabilities = {
    fs: { readTextFile: toolsAllowed, writeTextFile: canWrite },
    terminal: canUseTerminal,
  }
  return {
    client,
    capabilities,
    close: async () => {
      await Promise.all([...terminals.values()].map((terminal) => stopAcpChild(terminal.child)))
      terminals.clear()
    },
  }
}
