import { selectPermissionPreset, permissionPolicyLabel } from '@dovo/protocol'
import { useState, type ComponentProps, type ReactNode } from 'react'
import {
  Check,
  LockKeyhole,
  LockKeyholeOpen,
  Pencil,
  Sparkles,
  Eye,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { decode, selectableAccessModes, supportsAccess, taskHarnessSchema } from '@dovo/protocol'
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
import {
  ComposerEffortColumn,
  ComposerPickerDaybreak,
  ComposerPickerSpeed,
} from './composer-model-options'
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
  const { catalog, loading, error: catalogError } = useHarnessCatalog(value, !disabled)
  const selected =
    catalog?.models.find((model) => model.id === value.model) ??
    (!value.model ? catalog?.models.find((model) => model.isDefault) : undefined)
  const automatic = pickerProps.modelSelection === 'auto' || pickerProps.modelSelection === 'smart'
  const AccessIcon = accessIcon[value.permission]
  const locked = disabled
  const itemClass =
    'relative flex cursor-default select-none items-center rounded-md py-1.5 pl-3 pr-8 text-sm outline-none transition-colors duration-150 focus:bg-accent/50 data-[state=checked]:bg-accent/65 data-[disabled]:pointer-events-none data-[disabled]:opacity-40'
  const access = !modelOnly && (
    <>
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-7 w-52 min-w-0 max-w-[65%] gap-2 text-xs font-normal"
            style={{ borderColor: 'var(--control-edge)' }}
            disabled={locked}
            aria-label="Configure thread permissions"
            title={`Agent access: ${permissionPolicyLabel(value)}`}
          >
            <AccessIcon className="size-3.5" />
            <span className="min-w-0 flex-1 truncate text-left">
              {permissionPolicyLabel(value)}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="studio-menu-surface z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border bg-[var(--studio-floating-fill)] p-1.5 text-popover-foreground"
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
              {selectableAccessModes(value.permission, value.provider)
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
                  className="studio-menu-surface z-50 w-80 rounded-2xl border bg-[var(--studio-floating-fill)] p-1.5 text-popover-foreground"
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
                  className="studio-menu-surface z-50 w-80 rounded-2xl border bg-[var(--studio-floating-fill)] p-1.5 text-popover-foreground"
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
  const model = (
    <div role="group" aria-label="Model and reasoning" className="inline-flex min-w-0 max-w-full">
      <ComposerModelPicker
        {...pickerProps}
        modelsOnly={modelOnly}
        value={value}
        disabled={disabled}
        onChange={onChange}
        settings={
          <ComposerEffortColumn
            value={value}
            catalog={catalog}
            automatic={automatic}
            modes={!modelOnly}
            difficulty={modelSelectionDifficulty}
            onSelectDifficulty={onSelectDifficulty}
            onChange={onChange}
            disabled={disabled}
            loading={loading}
            error={catalogError}
          />
        }
        footer={
          !modelOnly && (
            <>
              {!automatic && (
                <ComposerPickerDaybreak
                  value={value}
                  catalog={catalog}
                  onChange={onChange}
                  disabled={disabled}
                />
              )}
              {!automatic && (
                <ComposerPickerSpeed
                  value={value}
                  catalog={catalog}
                  onChange={onChange}
                  disabled={disabled}
                />
              )}
              <div className="flex min-h-7 items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Access</span>
                {access}
              </div>
            </>
          )
        }
        effortLabel={
          automatic
            ? modelSelectionDifficulty || 'auto'
            : value.reasoning || selected?.defaultReasoning || ''
        }
        fast={!automatic && ['priority', 'fast'].includes(value.serviceTier ?? '')}
      />
    </div>
  )
  return renderControls ? renderControls({ model, access: null }) : model
}
