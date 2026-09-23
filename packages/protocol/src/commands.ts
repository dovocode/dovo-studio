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
  acp: Schema.optionalWith(executable, {
    default: () => '',
  }),
})
export type CommandSettings = Schema.Schema.Type<typeof commandsSchema>
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
    id: 'acp',
    label: 'ACP executable',
    placeholder: 'Set on each agent or enter a default',
  },
] as const
