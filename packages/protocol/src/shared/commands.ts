import { mutableArray, mutableStruct } from './schema.js'
import { maxValue, refine, minValue } from './schema.js'
import { Schema } from 'effect'
const executable = refine(
  maxValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 4096),
  (value) => !/[\0\r\n]/.test(value),
  'Enter one executable name or path',
)
export const commandsSchema = mutableStruct({
  shell: Schema.optionalWith(executable, {
    default: () => '',
  }),
  shellArgs: Schema.optionalWith(
    maxValue(
      mutableArray(refine(maxValue(Schema.String, 4096), (value) => !value.includes('\0'))),
      30,
    ),
    {
      default: () => ['-l'],
    },
  ),
  git: Schema.optionalWith(minValue(executable, 1), {
    default: () => 'git',
  }),
  gh: Schema.optionalWith(minValue(executable, 1), {
    default: () => 'gh',
  }),
  az: Schema.optionalWith(minValue(executable, 1), {
    default: () => 'az',
  }),
  tea: Schema.optionalWith(minValue(executable, 1), {
    default: () => 'tea',
  }),
  bb: Schema.optionalWith(minValue(executable, 1), {
    default: () => 'bb',
  }),
  fj: Schema.optionalWith(minValue(executable, 1), {
    default: () => 'fj',
  }),
  acli: Schema.optionalWith(minValue(executable, 1), {
    default: () => 'acli',
  }),
  codex: Schema.optionalWith(minValue(executable, 1), {
    default: () => 'codex',
  }),
  claude: Schema.optionalWith(executable, {
    default: () => '',
  }),
  hermes: Schema.optionalWith(minValue(executable, 1), {
    default: () => 'hermes',
  }),
  copilot: Schema.optionalWith(minValue(executable, 1), { default: () => 'copilot' }),
  grok: Schema.optionalWith(minValue(executable, 1), { default: () => 'grok' }),
  muse: Schema.optionalWith(minValue(executable, 1), { default: () => 'muse' }),
  acp: Schema.optionalWith(executable, {
    default: () => '',
  }),
  cua: Schema.optionalWith(executable, { default: () => '' }),
  cuaEnabled: Schema.optionalWith(Schema.Boolean, { default: () => false }),
})
export type CommandSettings = Schema.Schema.Type<typeof commandsSchema>
export const cuaCheckRequest = mutableStruct({ path: executable })
export const cuaHistoryStateSchema = mutableStruct({
  admitted: Schema.Boolean,
  enabled: Schema.Boolean,
  encrypted: Schema.Boolean,
  health: Schema.String,
  paused: Schema.Boolean,
  supported: Schema.Boolean,
})
export const cuaCheckResponse = mutableStruct({
  path: Schema.NullOr(Schema.String),
  available: Schema.Boolean,
  version: Schema.NullOr(Schema.String),
  detail: Schema.String,
  daemon: Schema.NullOr(Schema.String),
  permissions: Schema.NullOr(Schema.String),
  platform: Schema.String,
  historyState: Schema.optionalWith(Schema.NullOr(cuaHistoryStateSchema), { default: () => null }),
  history: Schema.optionalWith(Schema.NullOr(Schema.String), { default: () => null }),
  skills: Schema.optionalWith(Schema.NullOr(Schema.String), { default: () => null }),
})
export type CuaCheck = Schema.Schema.Type<typeof cuaCheckResponse>
export const commandSettingsResponse = mutableStruct({
  settings: commandsSchema,
  defaultShell: Schema.String,
})
export const commandFields = [
  {
    id: 'shell',
    label: 'Terminal shell',
    placeholder: 'Automatic: zsh / bash',
  },
  {
    id: 'git',
    label: 'Git executable',
    placeholder: 'git',
  },
  {
    id: 'gh',
    label: 'GitHub CLI executable',
    placeholder: 'gh',
  },
  {
    id: 'az',
    label: 'Azure CLI executable',
    placeholder: 'az',
  },
  {
    id: 'tea',
    label: 'Gitea / Forgejo CLI executable',
    placeholder: 'tea',
  },
  {
    id: 'bb',
    label: 'Bitbucket CLI executable (gildas)',
    placeholder: 'bb',
  },
  {
    id: 'fj',
    label: 'Forgejo CLI executable',
    placeholder: 'fj',
  },
  {
    id: 'acli',
    label: 'Atlassian CLI executable',
    placeholder: 'acli',
  },
  {
    id: 'codex',
    label: 'Codex executable',
    placeholder: 'codex',
  },
  {
    id: 'claude',
    label: 'Claude executable',
    placeholder: 'Bundled SDK default',
  },
  {
    id: 'hermes',
    label: 'Hermes executable',
    placeholder: 'hermes',
  },
  { id: 'copilot', label: 'Copilot executable', placeholder: 'copilot' },
  { id: 'grok', label: 'Grok Build executable', placeholder: 'grok' },
  { id: 'muse', label: 'Muse executable', placeholder: 'muse' },
  { id: 'cua', label: 'Cua Driver executable', placeholder: 'Automatic: cua-driver' },
  {
    id: 'acp',
    label: 'ACP executable',
    placeholder: 'Set on each agent or enter a default',
  },
] as const

/** Commands exposed by Studio; callers cannot supply arbitrary CLI arguments. */
export const cuaActions = [
  { id: 'start', label: 'Start CuaDriver', group: 'setup' },
  { id: 'stop', label: 'Stop daemon', group: 'setup' },
  { id: 'permissions', label: 'Request macOS permissions', group: 'setup' },
  { id: 'doctor', label: 'Run diagnostics', group: 'setup' },
  { id: 'test-desktop', label: 'Test desktop access', group: 'setup' },
  { id: 'skills-install', label: 'Install agent skills', group: 'skills' },
  { id: 'skills-update', label: 'Update agent skills', group: 'skills' },
  { id: 'history-enable', label: 'Enable Computer History', group: 'history' },
  { id: 'history-disable', label: 'Disable Computer History', group: 'history' },
  { id: 'history-pause', label: 'Pause history', group: 'history' },
  { id: 'history-resume', label: 'Resume history', group: 'history' },
  { id: 'history-list', label: 'View recent history', group: 'history' },
  { id: 'history-delete', label: 'Delete recorded history', group: 'history' },
] as const
export type CuaAction = (typeof cuaActions)[number]['id']
export const cuaActionRequest = mutableStruct({
  path: executable,
  action: Schema.Literal(...cuaActions.map((action) => action.id)),
})
export const cuaActionResponse = mutableStruct({ output: Schema.String, check: cuaCheckResponse })

export function cuaInstallHelp(platform: string) {
  if (platform === 'win32')
    return {
      prerequisites: 'Windows 10/11. Run PowerShell in the interactive desktop session to control.',
      commands: 'irm https://cua.ai/driver/install.ps1 | iex\ncua-driver autostart kick',
    }
  if (platform === 'darwin')
    return {
      prerequisites: 'macOS 14 or later. Run these commands in Terminal on this Mac.',
      commands:
        '/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"\nopen -n -g -a CuaDriver --args serve\ncua-driver permissions grant',
    }
  return {
    prerequisites:
      'An x86_64 Linux desktop with X11 or XWayland and AT-SPI 2. Run inside the desktop session; WSL does not control the Windows desktop.',
    commands: '/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"\ncua-driver serve',
  }
}

export function cuaActionDisabled(action: CuaAction, check: CuaCheck) {
  if (!action.startsWith('history-')) return false
  const state = check.historyState
  if (!state) return false // Older drivers expose text diagnostics; let the command report support.
  if (!state.supported) return true
  if (action === 'history-enable') return state.enabled
  if (action === 'history-disable') return !state.enabled
  if (action === 'history-pause') return !state.enabled || state.paused
  if (action === 'history-resume') return !state.enabled || !state.paused
  return false
}

export function cuaHistorySummary(check: CuaCheck) {
  const state = check.historyState
  if (!state) return check.history ?? 'History status is unavailable.'
  if (!state.supported) return 'Computer History is not supported by this driver build.'
  const mode = !state.enabled ? 'Disabled' : state.paused ? 'Paused' : 'Recording'
  return `${mode} · ${state.encrypted ? 'Encrypted' : 'Not encrypted'} · ${state.health}`
}
