import {
  decode,
  mcpServerSchema,
  type Agent,
  type CommandSettings,
  type CuaCheck,
} from '@dovo/protocol'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { exec, processEnvironment } from '../process.js'

export const CUA_SERVER_NAME = 'dovo_cua'
export const cuaInstructions = `This computer has opted in to desktop computer use through the dovo_cua MCP server. Read its bundled skill resources when available. Inspect apps and windows before acting; prefer accessibility element targets and background delivery. Verify changes from a fresh snapshot. Unsupported background actions must not silently fall back to foreground input. Do not blindly replay an action after a timeout. The desktop and app state are shared with the user and other agents. Use existing task browser CDP and simulator tools for those surfaces. Do not target the Dovo application UI. End your Cua session when finished.`

export async function cuaAgentServer(settings: CommandSettings, permission: Agent['permission']) {
  if (!settings.cuaEnabled || permission === 'read-only') return undefined
  const command = await detectCua(settings.cua)
  if (!command)
    throw new Error(
      'Computer use is enabled, but Cua Driver was not found. Configure its path in this computer’s CLI commands & shell settings, or disable computer use.',
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
  const [daemon, permissions] = await Promise.all([
    report(['status']),
    process.platform === 'darwin' ? report(['permissions', 'status']) : Promise.resolve(null),
  ])
  return { ...result, daemon, permissions }
}
