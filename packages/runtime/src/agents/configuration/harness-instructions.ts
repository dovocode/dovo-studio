import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { createPatch } from 'diff'
import {
  defaultTaskHarness,
  providerDisplayName,
  type AgentDiscovery,
  type HarnessInstructionFile,
  type HarnessInstructionSelection,
  type HarnessInstructionEdit,
} from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import { processEnvironment } from '../../process.js'
import type { AgentRegistry } from './registry.js'
import type { WorkspaceStore } from '../../storage/workspace.js'
import { withFileWrite } from '../../scm/repositories/file-writes.js'

const supported = ['codex', 'claude', 'pi', 'opencode', 'copilot', 'hermes'] as const
const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const version = (path: string, exists: boolean, text: string) => hash([path, exists, text])
const description: Record<(typeof supported)[number], string> = {
  codex: 'AGENTS.override.md takes precedence over AGENTS.md when present.',
  claude: 'User instructions for Claude sessions in this configuration directory.',
  pi: 'Pi uses the first matching context file: AGENTS.override.md, AGENTS.md or CLAUDE.md.',
  opencode:
    'Global OpenCode rules. Creating this file takes precedence over Claude fallback rules.',
  copilot: 'User instructions applied across repositories by Copilot CLI.',
  hermes: 'Hermes uses SOUL.md for its profile identity and instructions.',
}
function root(agent: AgentDiscovery) {
  const env = processEnvironment(agent.env)
  const home = env.HOME || env.USERPROFILE || homedir()
  const path =
    agent.provider === 'codex'
      ? env.CODEX_HOME || join(home, '.codex')
      : agent.provider === 'claude'
        ? env.CLAUDE_CONFIG_DIR || join(home, '.claude')
        : agent.provider === 'pi'
          ? env.PI_CODING_AGENT_DIR || join(home, '.pi', 'agent')
          : agent.provider === 'opencode'
            ? join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode')
            : agent.provider === 'copilot'
              ? env.COPILOT_HOME || join(home, '.copilot')
              : env.HERMES_HOME || join(home, '.hermes')
  const expanded = path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path
  if (!isAbsolute(expanded))
    throw new HttpError(
      400,
      'Use an absolute harness configuration directory to edit its instructions.',
    )
  return expanded
}
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if (!missing(error)) throw error
    // Never replace a dangling link with a new regular file.
    const info = await lstat(path).catch((cause: unknown) => {
      if (!missing(cause)) throw cause
      return undefined
    })
    if (info?.isSymbolicLink())
      throw new HttpError(409, 'The instruction file has a broken symlink.')
    return join(await canonical(dirname(path)), basename(path))
  }
}

export class HarnessInstructions {
  constructor(
    private store: WorkspaceStore,
    private registry: AgentRegistry,
  ) {}

  async list() {
    const files = new Map<string, HarnessInstructionFile>()
    const notices: string[] = []
    const agents = [
      ...supported.map((provider) => ({
        ...defaultTaskHarness(provider),
        name: `${providerDisplayName(provider)} · Default`,
      })),
      ...this.store.agentsFor(),
    ]
    for (const value of agents) {
      const provider = supported.find((item) => item === value.provider)
      if (!provider) continue
      try {
        const directory = root(this.registry.configure(value))
        const names =
          provider === 'claude'
            ? ['CLAUDE.md']
            : provider === 'hermes'
              ? ['SOUL.md']
              : provider === 'copilot'
                ? ['copilot-instructions.md']
                : ['AGENTS.md']
        if (provider === 'codex' || provider === 'pi') {
          const alternatives =
            provider === 'codex'
              ? ['AGENTS.override.md']
              : ['AGENTS.override.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']
          for (const name of alternatives) {
            const info = await lstat(join(directory, name)).catch((error: unknown) => {
              if (!missing(error)) throw error
              return undefined
            })
            if (info) names.push(name)
          }
        }
        for (const name of names) {
          const path = join(directory, name)
          const id = hash([provider, path])
          const previous = files.get(id)
          if (previous) {
            if (!previous.profiles.includes(value.name)) previous.profiles.push(value.name)
          } else
            files.set(id, {
              id,
              provider,
              name,
              path,
              profiles: [value.name],
              description: description[provider],
            })
        }
      } catch (error) {
        notices.push(`${value.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { files: [...files.values()], notices }
  }
  private async target(input: HarnessInstructionSelection) {
    const file = (await this.list()).files.find((item) => item.id === input.id)
    if (!file) throw new HttpError(409, 'The harness configuration changed. Reload the file list.')
    return file
  }
  private async readFile(file: HarnessInstructionFile) {
    const path = await canonical(file.path)
    const entry = await lstat(path).catch((error: unknown) => {
      if (!missing(error)) throw error
      return undefined
    })
    if (entry && !entry.isFile())
      throw new HttpError(400, 'Instructions must be a regular text file.')
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    ).catch((error: unknown) => {
      if (!missing(error)) throw error
      return undefined
    })
    if (!handle)
      return {
        text: '',
        version: version(path, false, ''),
        exists: false,
        resolvedPath: path,
        mode: 0o600,
      }
    try {
      const before = await handle.stat()
      if (!before.isFile()) throw new HttpError(400, 'Instructions must be a regular text file.')
      if (before.size > 200_000)
        throw new HttpError(413, 'Instruction file is too large to edit here.')
      const buffer = Buffer.alloc(Math.min(before.size + 1, 200_001))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      if (bytesRead > 200_000)
        throw new HttpError(413, 'Instruction file is too large to edit here.')
      const bytes = buffer.subarray(0, bytesRead)
      const text = bytes.toString('utf8')
      if (text.includes('\0')) throw new HttpError(415, 'Instructions must be a text file.')
      if (!bytes.equals(Buffer.from(text, 'utf8')))
        throw new HttpError(415, 'Instructions must use UTF-8 text.')
      const after = await handle.stat()
      if (
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        bytesRead !== before.size
      )
        throw new HttpError(409, 'Instructions changed while reading. Reload the file.')
      return {
        text,
        version: version(path, true, text),
        exists: true,
        resolvedPath: path,
        mode: before.mode & 0o777,
      }
    } finally {
      await handle.close()
    }
  }
  async read(input: HarnessInstructionSelection) {
    const { mode: _mode, ...file } = await this.readFile(await this.target(input))
    return file
  }
  private async review(input: HarnessInstructionEdit) {
    const bytes = Buffer.from(input.text, 'utf8')
    if (input.text.includes('\0') || bytes.toString('utf8') !== input.text)
      throw new HttpError(415, 'Instructions must use UTF-8 text without NUL characters.')
    if (bytes.length > 200_000) throw new HttpError(413, 'Instruction text is too large.')
    const file = await this.target(input)
    const current = await this.readFile(file)
    if (current.version !== input.version)
      throw new HttpError(
        409,
        'Instructions changed on disk. Reload the file before saving. Your draft is kept.',
      )
    return {
      file,
      current,
      diff: createPatch(file.name, current.text, input.text),
      changed: current.text !== input.text,
    }
  }
  async preview(input: HarnessInstructionEdit) {
    const { diff, changed } = await this.review(input)
    return { diff, changed }
  }
  async save(input: HarnessInstructionEdit) {
    const initial = await this.review(input)
    if (!initial.changed) return { version: initial.current.version }
    // The shared lock resolves its parent. Only Save may create a missing config directory.
    await mkdir(dirname(initial.current.resolvedPath), { recursive: true, mode: 0o700 })
    return withFileWrite(initial.current.resolvedPath, async () => {
      const { current, changed } = await this.review(input)
      if (!changed) return { version: current.version }
      await mkdir(dirname(current.resolvedPath), { recursive: true })
      const temp = join(dirname(current.resolvedPath), `.dovo-${randomUUID()}.tmp`)
      try {
        const handle = await open(temp, 'wx', current.mode)
        try {
          await handle.writeFile(input.text, 'utf8')
          await handle.chmod(current.mode)
        } finally {
          await handle.close()
        }
        // Re-resolve the profile and symlink immediately before replacement.
        await this.review(input)
        await rename(temp, current.resolvedPath)
      } finally {
        await rm(temp, { force: true })
      }
      return { version: version(current.resolvedPath, true, input.text) }
    })
  }
}
