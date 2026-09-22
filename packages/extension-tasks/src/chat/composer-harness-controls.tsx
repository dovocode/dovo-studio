import { useRef, useState } from 'react'
import {
  Check,
  LockKeyhole,
  LockKeyholeOpen,
  Pencil,
  Sparkles,
  Eye,
  Zap,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import {
  accessModes,
  daybreakChoices,
  modelServiceTiers,
  serviceTierValue,
  defaultTaskHarness,
  lockedTaskProvider,
  resolveTaskAgent,
  supportsAccess,
  taskHarnessSchema,
  updateTask,
  useWorkspace,
  type Task,
  type TaskHarness,
} from '@dovo/studio-core'
import { Button, DropdownMenu } from '@dovo/studio-ui'
import { HarnessDialog } from '../harness-dialog'
import { TaskSettings } from '../task-settings'
import { changeTaskHarness, chooseTaskAgent } from './task-harness-selection'
import { ComposerModelPicker } from './composer-model-picker'
import { useHarnessCatalog } from './harness-catalog'
const effortName = (id: string) =>
  ({
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra High',
    max: 'Max',
    ultra: 'Ultra',
    minimal: 'Minimal',
    none: 'None',
  })[id] ?? id
const accessIcon = {
  ask: LockKeyhole,
  'workspace-write': Pencil,
  auto: Sparkles,
  'full-access': LockKeyholeOpen,
  'read-only': Eye,
}
export function ComposerHarnessControls({ task, disabled }: { task: Task; disabled: boolean }) {
  const { workspace, setWorkspace, flush } = useWorkspace()
  const providerLock = lockedTaskProvider(task, workspace.agents)
  const resolved = resolveTaskAgent(task, workspace.agents)
  const value = resolved
    ? taskHarnessSchema.parse(resolved)
    : defaultTaskHarness(providerLock ?? 'codex')
  const [open, setOpen] = useState(false)
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const [connection, setConnection] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const { catalog, loading, error: catalogError } = useHarnessCatalog(value, open || reasoningOpen)
  const selected =
    catalog?.models.find((model) => model.id === value.model) ??
    (!value.model ? catalog?.models.find((model) => model.isDefault) : undefined)
  const effectiveReasoning = value.reasoning || selected?.defaultReasoning
  const AccessIcon = accessIcon[value.permission]
  const fast = ['priority', 'fast'].includes(serviceTierValue(value.serviceTier))
  const efforts = selected?.reasoning ?? catalog?.reasoning ?? []
  const tiers =
    value.provider === 'codex' ? modelServiceTiers(catalog, value.model, value.serviceTier) : []
  const save = async (change: (current: Task, agents: typeof workspace.agents) => Task) => {
    if (disabled || savingRef.current || task.status === 'running') return false
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      setWorkspace((w) => updateTask(w, task.id, (t) => change(t, w.agents)))
      await flush()
      return true
    } catch (error) {
      setError(String(error))
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const apply = (harness: TaskHarness) =>
    save((current, agents) => changeTaskHarness(current, agents, harness))
  const customAgent = !task.harness
    ? workspace.agents.find((agent) => agent.id === task.agentId)
    : undefined
  const locked = disabled || saving || task.status === 'running'
  const itemClass =
    'relative flex cursor-default select-none items-center rounded-md py-2 pl-3 pr-8 text-sm outline-none transition-colors duration-150 focus:bg-accent/50 data-[state=checked]:bg-accent/65 data-[disabled]:pointer-events-none data-[disabled]:opacity-40'
  return (
    <>
      <ComposerModelPicker
        agents={workspace.agents}
        selectedAgent={customAgent}
        value={value}
        lockedProvider={providerLock}
        disabled={locked}
        onChange={apply}
        onSelectAgent={(agentId) =>
          save((current, agents) => chooseTaskAgent(current, agents, agentId))
        }
        onUseHarness={(provider) =>
          save((current, agents) =>
            changeTaskHarness(current, agents, defaultTaskHarness(provider), true),
          )
        }
        onConfigure={() => setConnection(true)}
      />
      <span className="mx-1 h-4 border-l border-border/60" />
      <DropdownMenu.Root open={reasoningOpen} onOpenChange={setReasoningOpen}>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            disabled={locked}
            aria-label="Reasoning and speed"
            className="h-8 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
          >
            {fast && <Zap className="size-3.5 fill-current" />}
            {effectiveReasoning ? effortName(effectiveReasoning) : 'Default'}
            <ChevronDown size={12} />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-60 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
          >
            <DropdownMenu.Label className="px-3 py-2 text-xs text-muted-foreground">
              Reasoning
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              value={value.reasoning || selected?.defaultReasoning || ''}
              onValueChange={(reasoning) => void apply({ ...value, reasoning })}
            >
              {[
                ...(!selected?.defaultReasoning ? [{ id: '', name: 'Provider default' }] : []),
                ...efforts,
                ...(value.reasoning && !efforts.some((e) => e.id === value.reasoning)
                  ? [{ id: value.reasoning, name: value.reasoning }]
                  : []),
              ].map((effort) => (
                <DropdownMenu.RadioItem key={effort.id} value={effort.id} className={itemClass}>
                  {effortName(effort.id || effort.name)}
                  {effort.id === selected?.defaultReasoning && (
                    <span className="ml-2 rounded border border-border/60 px-1 text-[10px] text-muted-foreground">
                      Default
                    </span>
                  )}
                  <DropdownMenu.ItemIndicator className="absolute right-3">
                    <Check size={14} />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            {!!tiers.length && (
              <>
                <DropdownMenu.Separator className="mx-2 my-2 border-t" />
                <DropdownMenu.Label className="px-3 py-2 text-xs text-muted-foreground">
                  Service Tier
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup
                  aria-label="Service tier"
                  value={serviceTierValue(value.serviceTier)}
                  onValueChange={(serviceTier) => void apply({ ...value, serviceTier })}
                >
                  {tiers.map((tier) => (
                    <DropdownMenu.RadioItem
                      key={tier.id}
                      value={tier.id}
                      data-value={tier.id}
                      disabled={
                        tier.id !== 'default' &&
                        (!selected?.serviceTiers?.some((item) => item.id === tier.id) ||
                          catalog?.codex?.fastModeBlocked)
                      }
                      className={itemClass}
                    >
                      <span>
                        {tier.name}
                        {tier.id === 'default' && (
                          <span className="ml-2 rounded border border-border/60 px-1 text-[10px] text-muted-foreground">
                            Default
                          </span>
                        )}
                        {tier.description && tier.id !== 'default' && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {tier.description}
                          </span>
                        )}
                      </span>
                      <DropdownMenu.ItemIndicator className="absolute right-3">
                        <Check className="size-3.5" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </>
            )}
            {value.provider === 'codex' && (
              <DropdownMenu.Sub>
                <DropdownMenu.Separator className="mx-2 my-2 border-t" />
                <DropdownMenu.SubTrigger className={itemClass}>
                  Daybreak
                  <span className="ml-auto pl-3 text-xs text-muted-foreground">
                    {
                      daybreakChoices(catalog, value.cyberAccessProgram).find(
                        (choice) => choice.id === (value.cyberAccessProgram ?? ''),
                      )?.name
                    }
                  </span>
                  <ChevronRight className="absolute right-2 size-3" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    sideOffset={8}
                    collisionPadding={12}
                    className="z-50 w-60 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
                  >
                    <DropdownMenu.RadioGroup
                      aria-label="Daybreak mode"
                      value={value.cyberAccessProgram ?? ''}
                      onValueChange={(program) =>
                        void apply({
                          ...value,
                          cyberAccessProgram: program
                            ? taskHarnessSchema.shape.cyberAccessProgram.parse(program)
                            : undefined,
                        })
                      }
                    >
                      {daybreakChoices(catalog, value.cyberAccessProgram).map((choice) => (
                        <DropdownMenu.RadioItem
                          key={choice.id}
                          value={choice.id}
                          className={itemClass}
                          disabled={
                            choice.id !== '' &&
                            choice.id !== 'standard' &&
                            !catalog?.codex?.daybreakPrograms.some(
                              (program) => program === choice.id,
                            )
                          }
                        >
                          {choice.name}
                          <DropdownMenu.ItemIndicator className="absolute right-3">
                            <Check className="size-3.5" />
                          </DropdownMenu.ItemIndicator>
                        </DropdownMenu.RadioItem>
                      ))}
                    </DropdownMenu.RadioGroup>
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      {catalog?.codex?.daybreakPrograms.length
                        ? 'Codex verifies model and account access. Auto review is recommended.'
                        : 'Requires an eligible ChatGPT account and an updated Codex harness.'}
                    </p>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            )}
            {loading && (
              <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
                Loading…
              </p>
            )}
            {catalogError && (
              <p role="alert" className="px-3 py-2 text-xs text-destructive">
                {catalogError}
              </p>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <span className="mx-1 h-4 border-l border-border/60" />
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-8 gap-1.5 rounded-lg px-2 text-[11px] font-normal text-muted-foreground"
            disabled={locked}
            aria-label="Configure task permissions"
            title="Agent access"
          >
            <AccessIcon className="size-3.5" />
            {accessModes.find((mode) => mode.id === value.permission)?.name ?? value.permission}
            <ChevronDown size={12} />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
          >
            <DropdownMenu.Label className="px-3 py-2 text-xs text-muted-foreground">
              Access
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              aria-label="Harness access"
              value={value.permission}
              onValueChange={(permission) =>
                void apply({
                  ...value,
                  permission: taskHarnessSchema.shape.permission.parse(permission),
                })
              }
            >
              {accessModes
                .filter(
                  (mode) => supportsAccess(value.provider, mode.id) || mode.id === value.permission,
                )
                .map((mode) => {
                  const ModeIcon = accessIcon[mode.id]
                  return (
                    <DropdownMenu.RadioItem
                      key={mode.id}
                      value={mode.id}
                      data-value={mode.id}
                      disabled={!supportsAccess(value.provider, mode.id)}
                      className={itemClass}
                    >
                      <span>
                        <span className="flex items-center gap-2">
                          <ModeIcon className="size-3.5 text-muted-foreground" />
                          {mode.name}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {mode.description}
                        </span>
                      </span>
                      <DropdownMenu.ItemIndicator className="absolute right-3">
                        <Check className="size-3.5" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  )
                })}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="mx-2 my-2 border-t" />
            <DropdownMenu.Item className={itemClass} onSelect={() => setConnection(true)}>
              {customAgent ? 'Custom agent settings…' : 'Connection and instructions…'}
            </DropdownMenu.Item>
            {loading && (
              <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
                Loading provider models…
              </p>
            )}
            {catalogError && (
              <p role="alert" className="px-3 py-2 text-xs text-destructive">
                {catalogError}
              </p>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      )}
      {connection &&
        (customAgent ? (
          <TaskSettings task={task} open onOpenChange={setConnection} />
        ) : (
          <HarnessDialog task={task} onClose={() => setConnection(false)} />
        ))}
    </>
  )
}
