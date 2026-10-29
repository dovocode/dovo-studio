import {
  automaticDifficultyChoices,
  selectPermissionPreset,
  permissionPolicyLabel,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { useState, type ComponentProps, type ReactNode } from 'react'
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
  decode,
  selectableAccessModes,
  daybreakChoices,
  modelServiceTiers,
  serviceTierValue,
  supportsAccess,
  taskHarnessSchema,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import {
  approvalPolicySchema,
  sandboxModeSchema,
  effectivePermissionPolicy,
  permissionPolicyCapabilities,
  permissionPolicyIssue,
  permissionPolicySummary,
} from '@dovo/protocol'
import {
  approvalPolicyNames,
  sandboxModeNames,
  permissionPolicyUpdateMessage,
} from './permission-policy-fields'
import { Button } from './components/ui/button'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ComposerModelPicker } from './composer-model-picker'
import { useHarnessCatalog } from './harness-catalog'
const effortName = (id: string) =>
  ({
    auto: 'Auto',
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
export type ComposerControlSlots = { model: ReactNode; access: ReactNode }

export function ComposerSettingsControls({
  value,
  disabled,
  onChange,
  modelSelectionDifficulty,
  onSelectDifficulty,
  modelOnly = false,
  renderControls,
  ...pickerProps
}: ComponentProps<typeof ComposerModelPicker> & {
  modelOnly?: boolean
  renderControls?: (controls: ComposerControlSlots) => ReactNode
  modelSelectionDifficulty?: string
  onSelectDifficulty?: (reasoning: string) => Promise<boolean>
}) {
  const { snapshot } = useWorkspace()
  const policySupported = snapshot?.permissionPolicySupported === true
  const capabilities = permissionPolicyCapabilities(value.provider)
  const policy = effectivePermissionPolicy(value)
  const policyIssue = permissionPolicyIssue(value)
  const [open, setOpen] = useState(false)
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const { catalog, loading, error: catalogError } = useHarnessCatalog(value, !disabled)
  const selected =
    catalog?.models.find((model) => model.id === value.model) ??
    (!value.model ? catalog?.models.find((model) => model.isDefault) : undefined)
  const automatic = pickerProps.modelSelection === 'auto' || pickerProps.modelSelection === 'smart'
  const effectiveReasoning = automatic
    ? modelSelectionDifficulty || 'auto'
    : value.reasoning || selected?.defaultReasoning
  const AccessIcon = accessIcon[value.permission]
  const fast = ['priority', 'fast'].includes(serviceTierValue(value.serviceTier))
  const efforts = selected?.reasoning ?? catalog?.reasoning ?? []
  const tiers =
    !modelOnly && !automatic && value.provider === 'codex'
      ? modelServiceTiers(catalog, value.model, value.serviceTier)
      : []
  const locked = disabled
  const itemClass =
    'relative flex cursor-default select-none items-center rounded-md py-1.5 pl-3 pr-8 text-sm outline-none transition-colors duration-150 focus:bg-accent/50 data-[state=checked]:bg-accent/65 data-[disabled]:pointer-events-none data-[disabled]:opacity-40'
  const model = (
    <div
      role="group"
      aria-label="Model and reasoning"
      className="inline-flex max-w-full min-w-0 items-center rounded-lg hover:bg-accent/50 focus-within:bg-accent/50"
    >
      <ComposerModelPicker
        {...pickerProps}
        modelsOnly={modelOnly}
        joined
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
      <DropdownMenu.Root open={reasoningOpen} onOpenChange={setReasoningOpen}>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            disabled={locked}
            aria-label={automatic ? 'Difficulty' : 'Reasoning and speed'}
            className="h-8 shrink-0 gap-1 rounded-l-none rounded-r-lg pl-1 pr-2 text-xs font-normal text-muted-foreground"
          >
            {fast && <Zap className="size-3.5 fill-current" />}
            {effectiveReasoning ? effortName(effectiveReasoning) : 'Default'}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="bottom"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="studio-menu-surface z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-60 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground"
          >
            <DropdownMenu.Label className="px-3 py-2 text-xs text-muted-foreground">
              {automatic ? 'Difficulty' : 'Reasoning'}
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              value={
                automatic
                  ? modelSelectionDifficulty || 'auto'
                  : value.reasoning || selected?.defaultReasoning || ''
              }
              onValueChange={(reasoning) =>
                void (automatic
                  ? onSelectDifficulty?.(reasoning)
                  : onChange({
                      ...value,
                      reasoning,
                    }))
              }
            >
              {(automatic
                ? automaticDifficultyChoices
                : [
                    ...(!selected?.defaultReasoning
                      ? [
                          {
                            id: '',
                            name: 'Provider default',
                          },
                        ]
                      : []),
                    ...efforts,
                    ...(value.reasoning && !efforts.some((e) => e.id === value.reasoning)
                      ? [
                          {
                            id: value.reasoning,
                            name: value.reasoning,
                          },
                        ]
                      : []),
                  ]
              ).map((effort) => (
                <DropdownMenu.RadioItem key={effort.id} value={effort.id} className={itemClass}>
                  {effortName(effort.id || effort.name)}
                  {!automatic && effort.id === selected?.defaultReasoning && (
                    <span className="ml-2 rounded border border-border/60 px-1 text-[0.625rem] text-muted-foreground">
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
                  onValueChange={(serviceTier) =>
                    void onChange({
                      ...value,
                      serviceTier,
                    })
                  }
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
                          <span className="ml-2 rounded border border-border/60 px-1 text-[0.625rem] text-muted-foreground">
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
            {!modelOnly && value.provider === 'codex' && (
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
                        void onChange({
                          ...value,
                          cyberAccessProgram: program
                            ? decode(
                                Schema.required(taskHarnessSchema.fields.cyberAccessProgram.schema),
                                program,
                              )
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
    </div>
  )
  const access = !modelOnly && (
    <>
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-6 gap-1.5 rounded-lg px-2 text-[0.6875rem] font-normal text-muted-foreground"
            disabled={locked}
            aria-label="Configure task permissions"
            title="Agent access"
          >
            <AccessIcon className="size-3.5" />
            {permissionPolicyLabel(value)}
            <ChevronDown size={12} />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="studio-menu-surface z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground"
          >
            <DropdownMenu.Label className="px-3 py-2 text-xs text-muted-foreground">
              Access mode
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              aria-label="Harness access"
              value={permissionPolicyLabel(value) === 'Custom' ? 'custom' : value.permission}
              onValueChange={(permission) =>
                void onChange(
                  selectPermissionPreset(
                    value,
                    decode(taskHarnessSchema.fields.permission, permission),
                  ),
                )
              }
            >
              {selectableAccessModes(value.permission)
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
                        <span className="mt-0.5 block text-xs text-muted-foreground">
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
            <DropdownMenu.Label className="px-3 py-2 text-xs text-muted-foreground">
              Advanced
            </DropdownMenu.Label>
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {permissionPolicySummary(value)}
            </p>
            {(value.approvalPolicy || value.sandboxMode) && (
              <DropdownMenu.Item
                className={itemClass}
                disabled={!policySupported}
                onSelect={() => void onChange(selectPermissionPreset(value, value.permission))}
              >
                Reset to access mode
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger
                aria-label="Approval policy"
                disabled={!policySupported}
                className={itemClass}
              >
                Approval policy
                <span className="ml-auto pl-3 text-xs text-muted-foreground">
                  {value.approvalPolicy ? approvalPolicyNames[value.approvalPolicy] : 'Inherit'}
                </span>
                <ChevronRight className="absolute right-2 size-3" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  sideOffset={8}
                  collisionPadding={12}
                  className="studio-menu-surface z-50 w-80 rounded-xl border bg-popover p-1.5 text-popover-foreground"
                >
                  <DropdownMenu.RadioGroup
                    aria-label="Approval policy"
                    value={value.approvalPolicy ?? ''}
                    onValueChange={(approvalPolicy) =>
                      void onChange({
                        ...value,
                        approvalPolicy: approvalPolicy
                          ? decode(approvalPolicySchema, approvalPolicy)
                          : undefined,
                      })
                    }
                  >
                    <DropdownMenu.RadioItem value="" className={itemClass}>
                      Inherit from access mode
                      <DropdownMenu.ItemIndicator className="absolute right-3">
                        <Check size={14} />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                    {approvalPolicySchema.literals.map((id) => (
                      <DropdownMenu.RadioItem
                        key={id}
                        value={id}
                        disabled={!capabilities.approvalPolicies.includes(id)}
                        className={itemClass}
                      >
                        {approvalPolicyNames[id]}
                        {capabilities.approvalPolicies.includes(id) ? '' : ' · Not supported'}
                        <DropdownMenu.ItemIndicator className="absolute right-3">
                          <Check size={14} />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    ))}
                  </DropdownMenu.RadioGroup>
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    {capabilities.approvalDescription}
                  </p>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger
                aria-label="Sandbox"
                disabled={!policySupported}
                className={itemClass}
              >
                Sandbox
                <span className="ml-auto pl-3 text-xs text-muted-foreground">
                  {value.sandboxMode ? sandboxModeNames[value.sandboxMode] : 'Inherit'}
                </span>
                <ChevronRight className="absolute right-2 size-3" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  sideOffset={8}
                  collisionPadding={12}
                  className="studio-menu-surface z-50 w-80 rounded-xl border bg-popover p-1.5 text-popover-foreground"
                >
                  <DropdownMenu.RadioGroup
                    aria-label="Sandbox"
                    value={value.sandboxMode ?? ''}
                    onValueChange={(sandboxMode) =>
                      void onChange({
                        ...value,
                        sandboxMode: sandboxMode
                          ? decode(sandboxModeSchema, sandboxMode)
                          : undefined,
                      })
                    }
                  >
                    <DropdownMenu.RadioItem value="" className={itemClass}>
                      Inherit from access mode
                      <DropdownMenu.ItemIndicator className="absolute right-3">
                        <Check size={14} />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                    {sandboxModeSchema.literals.map((id) => (
                      <DropdownMenu.RadioItem
                        key={id}
                        value={id}
                        disabled={!capabilities.sandboxModes.includes(id)}
                        className={itemClass}
                      >
                        {sandboxModeNames[id]}
                        {capabilities.sandboxModes.includes(id) ? '' : ' · Not supported'}
                        <DropdownMenu.ItemIndicator className="absolute right-3">
                          <Check size={14} />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    ))}
                  </DropdownMenu.RadioGroup>
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    {capabilities.sandboxDescription}
                  </p>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            {!policySupported && (
              <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
                {permissionPolicyUpdateMessage}
              </p>
            )}
            {policyIssue && (
              <p role="alert" className="px-3 py-2 text-xs text-destructive">
                {policyIssue}. Clear the override to inherit.
              </p>
            )}
            {policySupported && policy.readOnly && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Read-only access takes precedence over approval and sandbox overrides.
              </p>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  )
  return renderControls ? (
    renderControls({ model, access })
  ) : (
    <>
      {model}
      {access}
    </>
  )
}
