import { closeSync, openSync, readSync, fstatSync, constants, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { claudeLaunchFlags } from './launch-flags.js'
import { processEnvironment } from '../../process.js'

// Copy connection settings only. Hooks, MCP servers, permissions and unrelated
// settings env must never leak into a tools:none utility.
const connectionKeys = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
] as const
const maxSettingsBytes = 1024 * 1024

function settingsEnv(path: string): Record<string, string> {
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
    if (!fstatSync(fd).isFile()) throw new Error('settings must be a regular file')
    const buffer = Buffer.alloc(maxSettingsBytes + 1)
    let length = 0
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null)
      if (!count) break
      length += count
    }
    if (length > maxSettingsBytes) throw new Error('settings exceed 1 MiB')
    return connectionEnv(JSON.parse(buffer.toString('utf8', 0, length)))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {}
    throw new Error(`Could not read Claude connection settings: ${path}`)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function connectionEnv(settings: unknown): Record<string, string> {
  if (!settings || typeof settings !== 'object' || !('env' in settings)) return {}
  const env = settings.env
  if (!env || typeof env !== 'object') return {}
  return Object.fromEntries(
    connectionKeys.flatMap((key) => {
      const value = Reflect.get(env, key)
      return typeof value === 'string' ? [[key, value]] : []
    }),
  )
}

type SettingSource = 'user' | 'project' | 'local'
const defaultSources: readonly SettingSource[] = ['user', 'project', 'local']

function selectedSources(flags: Record<string, string | null>): ReadonlySet<SettingSource> {
  const value = flags['setting-sources']
  if (value === undefined) return new Set(defaultSources)
  if (value === null) throw new Error('Claude --setting-sources requires a value')
  if (value === '') return new Set()
  const sources = new Set<SettingSource>()
  for (const source of value.split(',').map((part) => part.trim())) {
    if (source !== 'user' && source !== 'project' && source !== 'local')
      throw new Error('Claude setting sources must be user, project or local')
    sources.add(source)
  }
  return sources
}

function inlineSettings(value: string, label: string): unknown {
  try {
    if (Buffer.byteLength(value) > maxSettingsBytes) throw new Error('settings exceed 1 MiB')
    const settings: unknown = JSON.parse(value)
    if (!settings || typeof settings !== 'object' || Array.isArray(settings))
      throw new Error('settings must be an object')
    return settings
  } catch {
    // Parser errors can quote credentials from the source JSON.
    throw new Error(`Could not read inline Claude ${label} settings`)
  }
}

/** Claude applies settings env over its launch env, in source precedence order. */
export function claudeEffectiveEnvironment(
  overrides?: Record<string, string>,
  cwd?: string,
  args?: readonly string[],
) {
  const env = processEnvironment(overrides)
  const home = env.HOME || homedir()
  const configured = env.CLAUDE_CONFIG_DIR || join(home, '.claude')
  const directory = resolve(
    cwd || home,
    configured.startsWith('~/') ? join(home, configured.slice(2)) : configured,
  )
  const flags = claudeLaunchFlags(args)
  const sources = selectedSources(flags)
  const paths: string[] = []
  if (sources.has('user')) paths.push(join(directory, 'settings.json'))
  if (cwd && sources.has('project')) paths.push(join(cwd, '.claude', 'settings.json'))
  if (cwd && sources.has('local')) {
    paths.push(join(cwd, '.claude', 'settings.local.json'))
    let root = resolve(cwd)
    while (dirname(root) !== root && !existsSync(join(root, '.git'))) root = dirname(root)
    if (root !== resolve(cwd) && existsSync(join(root, '.git')))
      paths.push(join(root, '.claude', 'settings.local.json'))
  }
  const managed =
    process.platform === 'darwin'
      ? '/Library/Application Support/ClaudeCode'
      : process.platform === 'win32'
        ? join(env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode')
        : '/etc/claude-code'
  if (flags.settings === null) throw new Error('Claude --settings requires a value')
  if (flags['managed-settings'] === null)
    throw new Error('Claude --managed-settings requires a value')
  if (flags.settings) {
    if (!flags.settings.trimStart().startsWith('{'))
      paths.push(resolve(cwd || home, flags.settings))
  }
  for (const path of paths) Object.assign(env, settingsEnv(path))
  if (flags.settings?.trimStart().startsWith('{'))
    Object.assign(env, connectionEnv(inlineSettings(flags.settings, 'connection')))
  if (flags['managed-settings'] !== undefined) {
    // SDK 0.3.309's parent-managed tier filters to restrictive policy keys.
    // In particular, env is discarded; promoting it here would route utilities
    // to an endpoint/auth configuration the coding session never uses.
    inlineSettings(flags['managed-settings'], 'managed')
  }
  Object.assign(env, settingsEnv(join(managed, 'managed-settings.json')))
  return env
}

export function claudeSubscriptionEnvironment(env: NodeJS.ProcessEnv) {
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return false
  if (
    ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].some(
      (key) => env[key] === '1' || env[key] === 'true',
    )
  )
    return false
  if (!env.ANTHROPIC_BASE_URL) return true
  try {
    return new URL(env.ANTHROPIC_BASE_URL).origin === 'https://api.anthropic.com'
  } catch {
    return false
  }
}
