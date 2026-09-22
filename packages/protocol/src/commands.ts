import { z } from 'zod'
const executable = z
  .string()
  .trim()
  .max(4096)
  .refine((value) => !/[\0\r\n]/.test(value), 'Enter one executable name or path')
export const commandsSchema = z.object({
  shell: executable.default(''),
  shellArgs: z
    .array(
      z
        .string()
        .max(4096)
        .refine((value) => !value.includes('\0')),
    )
    .max(30)
    .default(['-l']),
  git: executable.min(1).default('git'),
  gh: executable.min(1).default('gh'),
  az: executable.min(1).default('az'),
  tea: executable.min(1).default('tea'),
  bb: executable.min(1).default('bb'),
  fj: executable.min(1).default('fj'),
  acli: executable.min(1).default('acli'),
  codex: executable.min(1).default('codex'),
  claude: executable.default(''),
  acp: executable.default(''),
})
export type CommandSettings = z.infer<typeof commandsSchema>
export const commandSettingsResponse = z.object({
  settings: commandsSchema,
  defaultShell: z.string(),
})
export const commandFields = [
  { id: 'shell', label: 'Terminal shell', placeholder: 'Automatic: zsh / bash' },
  { id: 'git', label: 'Git executable', placeholder: 'git' },
  { id: 'gh', label: 'GitHub CLI executable', placeholder: 'gh' },
  { id: 'az', label: 'Azure CLI executable', placeholder: 'az' },
  { id: 'tea', label: 'Gitea / Forgejo CLI executable', placeholder: 'tea' },
  { id: 'bb', label: 'Bitbucket CLI executable (gildas)', placeholder: 'bb' },
  { id: 'fj', label: 'Forgejo CLI executable', placeholder: 'fj' },
  { id: 'acli', label: 'Atlassian CLI executable', placeholder: 'acli' },
  { id: 'codex', label: 'Codex executable', placeholder: 'codex' },
  { id: 'claude', label: 'Claude executable', placeholder: 'Bundled SDK default' },
  { id: 'acp', label: 'ACP executable', placeholder: 'Set on each agent or enter a default' },
] as const
