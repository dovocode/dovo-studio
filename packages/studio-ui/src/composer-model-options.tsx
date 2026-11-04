import {
  automaticDifficultyChoices,
  modelServiceTiers,
  selectedCatalogModel,
  serviceTierValue,
  daybreakChoices,
  decode,
  taskHarnessSchema,
  type ModelCatalog,
  type TaskHarness,
} from '@dovo/protocol'
import { Check, Zap } from 'lucide-react'
import { cn } from './lib/utils'
import { Schema } from 'effect'
import { ChoicePicker } from './choice-picker'
import { Input } from './components/ui/input'

export function ComposerEffortColumn({
  value,
  catalog,
  automatic,
  difficulty,
  onSelectDifficulty,
  onChange,
  disabled,
  loading,
  error,
  modes = true,
}: {
  value: TaskHarness
  catalog: ModelCatalog | null
  automatic: boolean
  difficulty?: string
  onSelectDifficulty?: (value: string) => Promise<boolean>
  onChange: (value: TaskHarness) => Promise<boolean>
  disabled: boolean
  loading: boolean
  error: string
  modes?: boolean
}) {
  const selected = selectedCatalogModel(catalog, value.model)
  const efforts = selected?.reasoning ?? catalog?.reasoning ?? []
  const current = automatic
    ? difficulty || 'auto'
    : value.reasoning || selected?.defaultReasoning || ''
  const choices = automatic
    ? automaticDifficultyChoices
    : [
        { id: '', name: 'Provider default' },
        ...efforts,
        ...(value.reasoning && !efforts.some((e) => e.id === value.reasoning)
          ? [{ id: value.reasoning, name: value.reasoning }]
          : []),
      ]
  const tabStop = choices.some((effort) => effort.id === current) ? current : choices[0]?.id
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2.5 text-[0.6875rem] font-medium text-muted-foreground">
        <span>{automatic ? 'Task difficulty' : 'Reasoning effort'}</span>
      </div>
      <div className="px-3 pb-2.5 pt-2">
        {choices.length > 6 ? (
          <ChoicePicker
            aria-label={automatic ? 'Difficulty' : 'Reasoning level'}
            value={current}
            disabled={disabled || (automatic && !onSelectDifficulty)}
            onValueChange={(reasoning) =>
              void (automatic ? onSelectDifficulty?.(reasoning) : onChange({ ...value, reasoning }))
            }
          >
            {choices.map((effort) => (
              <option key={effort.id} value={effort.id}>
                {effort.name}
              </option>
            ))}
          </ChoicePicker>
        ) : (
          <div
            role="radiogroup"
            aria-label={automatic ? 'Difficulty' : 'Reasoning level'}
            className="flex flex-wrap gap-1"
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
              const rows = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              )
              const index = rows.findIndex((row) => row === document.activeElement)
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? rows.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
              event.preventDefault()
              event.stopPropagation()
              rows[next]?.focus()
            }}
          >
            {choices.map((effort) => (
              <button
                key={effort.id}
                type="button"
                role="radio"
                aria-checked={effort.id === current}
                disabled={disabled || (automatic && !onSelectDifficulty)}
                tabIndex={effort.id === tabStop ? 0 : -1}
                title={
                  'description' in effort && typeof effort.description === 'string'
                    ? effort.description
                    : undefined
                }
                className={cn(
                  'flex min-h-7 items-center gap-1 rounded-md border border-transparent px-2 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
                  effort.id === current && 'bg-accent text-foreground',
                )}
                onClick={() =>
                  void (automatic
                    ? onSelectDifficulty?.(effort.id)
                    : onChange({ ...value, reasoning: effort.id }))
                }
              >
                <span className="min-w-0 flex-1 truncate">{effort.name}</span>
                {effort.id === current ? (
                  <Check className="size-3.5 shrink-0" />
                ) : !automatic && effort.id === selected?.defaultReasoning ? (
                  <span className="text-xs text-muted-foreground">Default</span>
                ) : null}
              </button>
            ))}
          </div>
        )}
        {modes && !automatic && value.provider === 'acp' && catalog?.acp && (
          <div className="mt-2 grid gap-2 border-t px-2 pt-2 text-xs text-muted-foreground">
            {!!catalog.acp.modes.length && (
              <label className="grid gap-1">
                Agent mode
                <ChoicePicker
                  aria-label="ACP mode"
                  value={value.acpMode ?? ''}
                  disabled={disabled}
                  onValueChange={(acpMode) =>
                    void onChange({ ...value, acpMode: acpMode || undefined })
                  }
                >
                  <option value="">Provider default</option>
                  {value.acpMode &&
                    !catalog.acp.modes.some((mode) => mode.id === value.acpMode) && (
                      <option value={value.acpMode}>{value.acpMode}</option>
                    )}
                  {catalog.acp.modes.map((mode) => (
                    <option key={mode.id} value={mode.id}>
                      {mode.name}
                    </option>
                  ))}
                </ChoicePicker>
              </label>
            )}
            {catalog.acp.configOptions.map((option) => {
              const current = value.acpConfig?.[option.id] ?? option.currentValue
              const update = (next: string) =>
                void onChange({ ...value, acpConfig: { ...value.acpConfig, [option.id]: next } })
              return (
                <label key={option.id} className="grid gap-1">
                  {option.name}
                  {option.options.length ? (
                    <ChoicePicker
                      aria-label={`ACP ${option.name}`}
                      value={current}
                      disabled={disabled}
                      onValueChange={update}
                    >
                      {current && !option.options.some((item) => item.id === current) && (
                        <option value={current}>{current}</option>
                      )}
                      {option.options.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </ChoicePicker>
                  ) : (
                    <Input
                      aria-label={`ACP ${option.name}`}
                      value={current}
                      disabled={disabled}
                      onChange={(event) => update(event.target.value)}
                    />
                  )}
                </label>
              )
            })}
          </div>
        )}
        {!automatic && efforts.length === 0 && !loading && (
          <p className="px-2 py-2 text-xs text-muted-foreground">No effort levels advertised.</p>
        )}
        {loading && (
          <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
            Loading options…
          </p>
        )}
        {error && (
          <p role="alert" className="px-2 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </>
  )
}

export function ComposerPickerDaybreak({
  value,
  catalog,
  onChange,
  disabled,
}: {
  value: TaskHarness
  catalog: ModelCatalog | null
  onChange: (value: TaskHarness) => Promise<boolean>
  disabled: boolean
}) {
  if (value.provider !== 'codex') return null
  return (
    <label className="flex min-h-7 items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>Daybreak</span>
      <ChoicePicker
        aria-label="Daybreak mode"
        className="h-7 w-44 max-w-[65%]"
        value={value.cyberAccessProgram ?? ''}
        disabled={disabled}
        onValueChange={(program) =>
          void onChange({
            ...value,
            cyberAccessProgram: program
              ? decode(Schema.required(taskHarnessSchema.fields.cyberAccessProgram.schema), program)
              : undefined,
          })
        }
      >
        {daybreakChoices(catalog, value.cyberAccessProgram).map((choice) => (
          <option
            key={choice.id}
            value={choice.id}
            disabled={
              choice.id !== '' &&
              choice.id !== 'standard' &&
              !catalog?.codex?.daybreakPrograms.some((program) => program === choice.id)
            }
          >
            {choice.name}
          </option>
        ))}
      </ChoicePicker>
    </label>
  )
}

export function ComposerPickerSpeed({
  value,
  catalog,
  onChange,
  disabled,
}: {
  value: TaskHarness
  catalog: ModelCatalog | null
  onChange: (value: TaskHarness) => Promise<boolean>
  disabled: boolean
}) {
  if (value.provider !== 'codex') return null
  const selected = selectedCatalogModel(catalog, value.model)
  const tiers = modelServiceTiers(catalog, value.model, value.serviceTier)
  if (tiers.length < 2) return null
  return (
    <div
      role="radiogroup"
      aria-label="Service tier"
      className="flex min-h-7 flex-wrap items-center justify-between gap-1"
    >
      <span className="text-xs text-muted-foreground">Speed</span>
      <div className="flex flex-wrap rounded-lg bg-accent/40 p-0.5">
        {tiers.map((tier) => {
          const checked = serviceTierValue(value.serviceTier) === tier.id
          return (
            <button
              type="button"
              key={tier.id}
              role="radio"
              aria-checked={checked}
              title={tier.description}
              data-value={tier.id}
              disabled={
                disabled ||
                (tier.id !== 'default' &&
                  (!selected?.serviceTiers?.some((item) => item.id === tier.id) ||
                    catalog?.codex?.fastModeBlocked === true))
              }
              className={cn(
                'flex min-h-7 items-center gap-1 rounded-md px-2 text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
                checked ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
              )}
              onClick={() => void onChange({ ...value, serviceTier: tier.id })}
            >
              {['priority', 'fast'].includes(tier.id) && <Zap className="size-3" />}
              {tier.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
