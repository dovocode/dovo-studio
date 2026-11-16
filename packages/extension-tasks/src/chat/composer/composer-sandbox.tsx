import { Box, ChevronDown, Monitor } from 'lucide-react'
import {
  containerSandboxNetworkWarning as sandboxNetworkWarning,
  containerSandboxEnabled,
  resolveScopedSettings,
  taskContainerSandbox,
  type ContainerSandbox,
} from '@dovo/protocol'
import { canChangeTaskCheckout, updateTask, useWorkspace, type Task } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button, DropdownMenu } from '@dovo/studio-ui'

/** Sandbox choice before the first message, and the thread's sandbox badge afterwards. */
export function ComposerSandbox({ task, disabled }: { task: Task; disabled: boolean }) {
  const uiText = useInterfaceText()
  const { workspace, setWorkspace, snapshot } = useWorkspace()
  if (!snapshot?.containerSandboxSupported) return null
  const repository = workspace.repositories.find((item) => item.id === task.repositoryId)
  const projectDefault = resolveScopedSettings(snapshot.defaults, repository).taskDefaults
    ?.containerSandbox
  const editable = canChangeTaskCheckout(task)
  const sandbox = taskContainerSandbox(task, snapshot.defaults, repository)
  const enabled = containerSandboxEnabled(sandbox)
  const status = snapshot.containerSandbox
  const thread = status?.threads.find((item) => item.taskId === task.id)
  const detail = [
    thread?.detail,
    sandbox?.network === 'none' ? uiText(sandboxNetworkWarning) : '',
    enabled && status && !status.available ? status.message : '',
  ]
    .filter(Boolean)
    .join('\n')
  if (!editable) {
    if (!enabled) return null
    return (
      <span
        className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[0.6875rem] ${thread?.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}
        title={detail || uiText('This thread runs in a Mise container sandbox.')}
        data-sandbox-state={thread?.state ?? 'stopped'}
      >
        <Box className="size-3" aria-hidden="true" />
        {uiText('Sandbox')}
        {thread && thread.state !== 'running' ? ` · ${uiText(thread.state)}` : ''}
        {sandbox?.network === 'none' ? ` · ${uiText('no network')}` : ''}
      </span>
    )
  }
  const choose = (mode: ContainerSandbox['mode']) =>
    setWorkspace((current) =>
      updateTask(current, task.id, (draft) =>
        canChangeTaskCheckout(draft)
          ? {
              ...draft,
              containerSandbox: {
                ...(draft.containerSandbox ?? projectDefault ?? { mode: 'off' }),
                mode,
              },
            }
          : draft,
      ),
    )
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-6 gap-1.5 px-2 text-[0.6875rem] font-normal"
          aria-label={uiText('Container sandbox')}
          data-value={enabled ? 'mise' : 'off'}
          disabled={disabled}
          title={detail || undefined}
        >
          {enabled ? <Box className="size-3" /> : <Monitor className="size-3" />}
          {enabled ? uiText('Sandbox') : uiText('Host')}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-50 w-80 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          <DropdownMenu.RadioGroup
            value={enabled ? 'mise' : 'off'}
            onValueChange={(value) => choose(value === 'mise' ? 'mise' : 'off')}
          >
            {(
              [
                ['off', 'Host', 'The agent runs on this computer with your user account.'],
                [
                  'mise',
                  'Mise sandbox',
                  'The agent, its commands and its terminals run in a container. Only this checkout and the harness login are mounted.',
                ],
              ] as const
            ).map(([value, label, description]) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                data-value={value}
                className="flex cursor-default items-start gap-3 rounded-md px-3 py-2 text-xs outline-none focus:bg-accent data-[state=checked]:bg-accent"
              >
                {value === 'mise' ? (
                  <Box className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <Monitor className="mt-0.5 size-4 shrink-0" />
                )}
                <span className="space-y-1">
                  <span className="block font-medium">{uiText(label)}</span>
                  <span className="block text-[0.6875rem] leading-relaxed text-muted-foreground">
                    {uiText(description)}
                  </span>
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          {enabled && detail && (
            <p className="whitespace-pre-line px-3 py-2 text-[0.6875rem] text-muted-foreground">
              {detail}
            </p>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
