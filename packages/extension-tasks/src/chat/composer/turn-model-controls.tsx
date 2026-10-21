import {
  agentTurnSettings,
  applyTurnSettings,
  modelCatalogChoices,
  type Agent,
  type TurnSettings,
  type TaskHarness,
} from '@dovo/protocol'
import {
  Button,
  ChoicePicker,
  ComposerSettingsControls,
  Popover,
  useHarnessCatalog,
} from '@dovo/studio-ui'
import { useState } from 'react'

/** Model choices here belong to one message, never to the active run or thread defaults. */
export function TurnModelControls({
  agent,
  value,
  onChange,
  disabled,
  inline = false,
  composer = false,
  repositoryId,
}: {
  agent: Agent
  value?: TurnSettings | null
  onChange: (value: TurnSettings | null) => void
  disabled?: boolean
  inline?: boolean
  composer?: boolean
  repositoryId?: string
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const selected = applyTurnSettings(agent, value ?? undefined)
  const { catalog, error, loading } = useHarnessCatalog(selected, composer || inline || open)
  const models = modelCatalogChoices(catalog?.models ?? []).filter(
    (m) => !m.hidden || m.id === selected.model,
  )
  const model =
    catalog?.models.find((m) => m.id === selected.model) ??
    (!selected.model ? catalog?.models.find((m) => m.isDefault) : undefined)
  const efforts = model?.reasoning ?? catalog?.reasoning ?? []
  const update = (change: Partial<Pick<TurnSettings, 'model' | 'reasoning'>>) =>
    onChange({ ...agentTurnSettings(selected), ...change })
  const controls = (
    <div className="flex min-w-0 flex-col gap-2 text-xs">
      <p className="text-muted-foreground">
        Only this turn. The active run and thread defaults stay unchanged.
      </p>
      <ChoicePicker
        aria-label="Turn model"
        value={value ? selected.model : '__inherit__'}
        disabled={disabled}
        onValueChange={(model) => {
          if (model === '__inherit__') {
            onChange(null)
            setCustom(false)
          } else if (model === '__custom__') {
            setCustom(true)
            update({})
          } else {
            setCustom(false)
            update({ model, reasoning: model === selected.model ? (selected.reasoning ?? '') : '' })
          }
        }}
      >
        <option value="__inherit__">Thread defaults</option>
        <option value="">Provider default</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
        {!!selected.model && !models.some((m) => m.id === selected.model) && (
          <option value={selected.model}>{selected.model} (saved/custom)</option>
        )}
        <option value="__custom__">Custom model…</option>
      </ChoicePicker>
      {custom && (
        <input
          aria-label="Turn custom model ID"
          className="h-8 rounded-md border bg-background px-2"
          disabled={disabled}
          value={selected.model}
          onChange={(e) => update({ model: e.target.value.trim(), reasoning: '' })}
        />
      )}
      <ChoicePicker
        aria-label="Turn reasoning level"
        disabled={disabled}
        value={value ? (selected.reasoning ?? '') : '__inherit__'}
        onValueChange={(reasoning) =>
          reasoning === '__inherit__' ? onChange(null) : update({ reasoning })
        }
      >
        {!value && <option value="__inherit__">Thread defaults</option>}
        <option value="">Provider default reasoning</option>
        {efforts.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
        {!!selected.reasoning && !efforts.some((e) => e.id === selected.reasoning) && (
          <option value={selected.reasoning}>{selected.reasoning} (saved)</option>
        )}
      </ChoicePicker>
      {value && (
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
          Use thread defaults
        </Button>
      )}
      {loading && <p role="status">Loading models…</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
  if (composer) {
    const change = async (next: TaskHarness) => {
      if (
        disabled ||
        next.provider !== agent.provider ||
        next.acpInstallationId !== agent.acpInstallationId
      )
        return false
      onChange(agentTurnSettings(next))
      return true
    }
    return (
      <>
        <span
          className="text-xs text-muted-foreground"
          title="Model and reasoning apply to the next queued message"
        >
          Next turn
        </span>
        <ComposerSettingsControls
          modelOnly
          value={selected}
          disabled={!!disabled}
          agents={[]}
          repositoryId={repositoryId}
          lockedProvider={agent.provider}
          lockedInstallationId={
            agent.provider === 'acp' ? (agent.acpInstallationId ?? '') : undefined
          }
          onChange={change}
          onUseHarness={change}
          onSelectAgent={async () => false}
          onConfigure={() => {}}
        />
        {value && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
            Use thread defaults
          </Button>
        )}
      </>
    )
  }
  if (inline) return controls
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          className="h-7 max-w-64 truncate text-xs"
          aria-label="Next turn model and reasoning"
        >
          {value
            ? `Next: ${model?.name || value.model || 'Provider default'} · ${value.reasoning || 'Default'}`
            : 'Next turn: thread defaults'}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-50 w-80 max-w-[calc(100vw-24px)] rounded-lg border bg-popover p-3 shadow-md"
        >
          {controls}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
