import {
  decode,
  decodeResult,
  cuaHistoryStateSchema,
  mcpServerSchema,
  type Agent,
  type CommandSettings,
  type CuaCheck,
  type CuaAction,
} from '@dovo/protocol'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { exec, processEnvironment, ProcessError } from '../process.js'
import { HttpError } from '../errors.js'

export const CUA_SERVER_NAME = 'dovo_cua'
export const cuaInstructions = `This computer has opted in to desktop computer use through the dovo_cua MCP server. Read its bundled skill resources when available. Inspect apps and windows before acting; prefer accessibility element targets and background delivery. Verify changes from a fresh snapshot. Unsupported background actions must not silently fall back to foreground input. Do not blindly replay an action after a timeout. The desktop and app state are shared with the user and other agents. Use existing task browser CDP and simulator tools for those surfaces. Do not target the Dovo application UI. End your Cua session when finished.`

export async function cuaAgentServer(settings: CommandSettings, permission: Agent['permission']) {
  if (!settings.cuaEnabled || permission === 'read-only') return undefined
  const command = await detectCua(settings.cua)
  if (!command)
    throw new Error(
      'Computer use is enabled, but Cua Driver was not found. Configure its path in this computer’s Computer use settings, or disable computer use.',
    )
  return decode(mcpServerSchema, {
    name: CUA_SERVER_NAME,
    enabled: true,
    transport: 'stdio',
    command,
    args: ['mcp'],
  })
}

export async function detectCua(command: string) {
  const explicit = isAbsolute(command) || command.includes('/') || command.includes('\\')
  const name = command || 'cua-driver'
  const directories = explicit
    ? ['']
    : [
        ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
        ...(!command
          ? process.platform === 'win32'
            ? process.env.LOCALAPPDATA
              ? [join(process.env.LOCALAPPDATA, 'Programs', 'Cua', 'cua-driver', 'bin')]
              : []
            : [join(homedir(), '.local', 'bin')]
          : []),
      ]
  const extensions = process.platform === 'win32' && !/\.[^\\/]+$/.test(name) ? ['', '.exe'] : ['']
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = explicit ? resolve(name) : resolve(directory, name + extension)
      try {
        await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
        if ((await stat(candidate)).isFile()) return candidate
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            ['ENOENT', 'ENOTDIR', 'EACCES'].includes(String(error.code))
          )
        )
          throw error
      }
    }
  }
  return null
}

export async function checkCua(command: string): Promise<CuaCheck> {
  const path = await detectCua(command)
  const result: CuaCheck = {
    path,
    available: false,
    version: null,
    daemon: null,
    permissions: null,
    platform: process.platform,
    history: null,
    historyState: null,
    skills: null,
    detail: command
      ? 'The configured Cua Driver executable was not found or is not executable.'
      : 'Cua Driver was not found on this runtime. Install it or enter its full executable path.',
  }
  if (!path) return result
  const run = async (args: string[]) => {
    const output = await exec(path, args, {
      timeout: 5000,
      maxBuffer: 64 * 1024,
      env: processEnvironment(),
      windowsHide: true,
    })
    return stripVTControlCharacters(output.stdout || output.stderr)
      .trim()
      .slice(0, 4000)
  }
  try {
    result.version = await run(['--version'])
    if (!/\bcua[-_ ]driver\b/i.test(result.version)) {
      result.detail =
        'The configured executable did not identify itself as Cua Driver. Check its path.'
      return result
    }
    result.available = true
    result.detail = 'Executable responds. Desktop control has not been tested.'
  } catch (error) {
    result.detail = `Cua Driver could not run: ${String(error)}`
    return result
  }
  const report = async (args: string[]) => {
    try {
      return await run(args)
    } catch (error) {
      return `Check failed: ${String(error)}`
    }
  }
  const [daemon, permissions, history, skills] = await Promise.all([
    report(['status']),
    process.platform === 'darwin' ? report(['permissions', 'status']) : Promise.resolve(null),
    report(['history', 'status', '--json']),
    report(['skills', 'status']),
  ])
  let historyState: CuaCheck['historyState'] = null
  try {
    const decoded = decodeResult(cuaHistoryStateSchema, JSON.parse(history))
    if (decoded.success) historyState = decoded.data
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    // Unsupported releases and unavailable daemons report text. Preserve that diagnostic.
  }
  return { ...result, daemon, permissions, history, historyState, skills }
}

const actionArguments: Record<Exclude<CuaAction, 'start'>, string[]> = {
  stop: ['stop'],
  permissions: ['permissions', 'grant'],
  doctor: ['doctor'],
  'test-desktop': ['call', 'list_apps'],
  'skills-install': ['skills', 'install'],
  'skills-update': ['skills', 'update'],
  'history-enable': ['history', 'enable'],
  'history-disable': ['history', 'disable'],
  'history-pause': ['history', 'pause'],
  'history-resume': ['history', 'resume'],
  'history-list': ['history', 'list', '20'],
  'history-delete': ['history', 'delete'],
}

// Serialize desktop-wide setup changes, including requests from other paired clients.
let activeAction = false
export async function cuaAction(command: string, action: CuaAction) {
  if (activeAction)
    throw new HttpError(409, 'Another Cua setup action is running. Wait for it to finish.')
  activeAction = true
  try {
    const check = await checkCua(command)
    if (!check.available || !check.path) throw new HttpError(400, check.detail)
    if (action === 'permissions' && process.platform !== 'darwin')
      throw new Error('Permission grants are managed by this command only on macOS.')
    if (action === 'start' && process.platform === 'linux')
      throw new Error(
        'Start cua-driver serve in a terminal inside the Linux desktop session and leave it open.',
      )
    const executable =
      action === 'start' && process.platform === 'darwin' ? '/usr/bin/open' : check.path
    const args =
      action === 'start'
        ? process.platform === 'darwin'
          ? ['-n', '-g', '-a', 'CuaDriver', '--args', 'serve']
          : ['autostart', 'kick']
        : actionArguments[action]
    const result = await exec(executable, args, {
      timeout: 60000,
      maxBuffer: 256 * 1024,
      env: processEnvironment(),
      windowsHide: true,
    })
    return {
      output:
        stripVTControlCharacters([result.stdout, result.stderr].filter(Boolean).join('\n'))
          .trim()
          .slice(0, 16000) || 'Command completed. Refresh status after any OS prompts or relaunch.',
      check: await checkCua(command),
    }
  } catch (error) {
    if (error instanceof ProcessError) {
      const detail = stripVTControlCharacters(String(error.stderr || error.stdout))
        .trim()
        .slice(0, 4000)
      const reason = error.signal
        ? `The driver command timed out or was interrupted (${error.signal}). ${detail}`
        : detail || error.message
      throw new Error(
        `Cua ${action} failed: ${reason}. Refresh status before retrying; the action may have partially completed.`,
      )
    }
    throw error
  } finally {
    activeAction = false
  }
}

/** Pass the official installed skill source to every harness, including isolated configs. */
export async function cuaSkillInstructions(command: string) {
  try {
    const result = await exec(command, ['skills', 'path'], {
      timeout: 5000,
      maxBuffer: 8192,
      env: processEnvironment(),
      windowsHide: true,
    })
    const directory = stripVTControlCharacters(result.stdout).trim()
    if (!isAbsolute(directory) || /[\r\n\0]/.test(directory))
      return 'The installed Cua skill path could not be resolved. Use the MCP bundled skill resources.'
    const source = join(directory, 'SKILL.md')
    try {
      if (!(await stat(source)).isFile())
        return 'Cua agent skills are not installed. Use the MCP bundled skill resources.'
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return 'Cua agent skills are not installed. Use the MCP bundled skill resources.'
      throw error
    }
    return `Official Cua Driver skill: read ${JSON.stringify(source)} before computer use; resolve supporting files from its containing folder. This skill does not grant desktop permissions or approve actions.`
  } catch (error) {
    return `Cua skill discovery failed: ${String(error).slice(0, 1000)}. Use the MCP bundled skill resources when available.`
  }
}
