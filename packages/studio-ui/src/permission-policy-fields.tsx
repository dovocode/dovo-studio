import {
  approvalPolicySchema,
  sandboxModeSchema,
  decode,
  effectivePermissionPolicy,
  permissionPolicyCapabilities,
  permissionPolicyIssue,
  permissionPolicyLabel,
  permissionPolicySummary,
  type PermissionPolicy,
} from '@dovo/protocol'
import { ChoicePicker } from './choice-picker'
import { FormField } from './components/form-field'
import { SettingRow } from './settings-layout'
import type { ReactNode } from 'react'

export const approvalPolicyNames = {
  untrusted: 'Untrusted commands',
  'on-failure': 'On failure',
  'on-request': 'On request',
  never: 'Never',
}
export const sandboxModeNames = {
  'read-only': 'Read only',
  'workspace-write': 'Workspace write',
  'danger-full-access': 'Full access',
}
export const permissionPolicyUpdateMessage =
  'Update this runtime to use separate approval and sandbox controls. Saved overrides are kept.'

/** Old runtimes must not decode away explicit restrictions during save or launch. */
export function permissionPolicyUIIssue(value: PermissionPolicy, supported: boolean) {
  return !supported && (value.approvalPolicy || value.sandboxMode)
    ? permissionPolicyUpdateMessage
    : permissionPolicyIssue(value)
}

export function PermissionPolicyFields({
  value,
  onChange,
  supported,
  disabled = false,
  layout,
  inherited,
  onReset,
  resetFields,
  onResetField,
  sources,
}: {
  value: PermissionPolicy
  onChange: (
    value: Pick<PermissionPolicy, 'approvalPolicy' | 'sandboxMode'>,
    field?: 'approvalPolicy' | 'sandboxMode',
  ) => void
  supported: boolean
  disabled?: boolean
  layout?: 'settings'
  inherited?: Pick<PermissionPolicy, 'approvalPolicy' | 'sandboxMode'>
  onReset?: () => void
  resetFields?: readonly ('approvalPolicy' | 'sandboxMode')[]
  onResetField?: (field: 'approvalPolicy' | 'sandboxMode') => void
  sources?: { approvalPolicy?: ReactNode; sandboxMode?: ReactNode }
}) {
  const capabilities = permissionPolicyCapabilities(value.provider)
  const displayed = {
    ...value,
    approvalPolicy: resetFields?.includes('approvalPolicy')
      ? undefined
      : (value.approvalPolicy ?? inherited?.approvalPolicy),
    sandboxMode: resetFields?.includes('sandboxMode')
      ? undefined
      : (value.sandboxMode ?? inherited?.sandboxMode),
  }
  const effective = effectivePermissionPolicy(displayed)
  const issue = permissionPolicyIssue(displayed)
  return (
    <details className="space-y-3">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Advanced · {permissionPolicyLabel(displayed)}
      </summary>
      <p className="text-xs text-muted-foreground">{permissionPolicySummary(displayed)}</p>
      {(value.approvalPolicy ||
        value.sandboxMode ||
        inherited?.approvalPolicy ||
        inherited?.sandboxMode) && (
        <button
          type="button"
          disabled={disabled || !supported}
          className="text-xs underline"
          onClick={() =>
            onReset ? onReset() : onChange({ approvalPolicy: undefined, sandboxMode: undefined })
          }
        >
          Reset to access mode
        </button>
      )}
      <PolicyField label="Approval policy" layout={layout} source={sources?.approvalPolicy}>
        <ChoicePicker
          aria-label="Approval policy"
          value={
            resetFields?.includes('approvalPolicy') ? 'access-mode' : (value.approvalPolicy ?? '')
          }
          disabled={disabled || !supported}
          onValueChange={(approvalPolicy) =>
            approvalPolicy === 'access-mode'
              ? onResetField?.('approvalPolicy')
              : onChange(
                  {
                    approvalPolicy: approvalPolicy
                      ? decode(approvalPolicySchema, approvalPolicy)
                      : undefined,
                    sandboxMode: value.sandboxMode,
                  },
                  'approvalPolicy',
                )
          }
        >
          {onResetField && <option value="access-mode">From access mode</option>}
          <option value="">
            {inherited?.approvalPolicy
              ? `Inherit (${approvalPolicyNames[inherited.approvalPolicy]})`
              : 'Inherit from access mode'}
          </option>
          {approvalPolicySchema.literals.map((id) => (
            <option key={id} value={id} disabled={!capabilities.approvalPolicies.includes(id)}>
              {approvalPolicyNames[id]}
              {capabilities.approvalPolicies.includes(id) ? '' : ' · Not supported'}
            </option>
          ))}
        </ChoicePicker>
        <p className="text-xs font-normal text-muted-foreground">
          {capabilities.approvalDescription}
        </p>
      </PolicyField>
      <PolicyField label="Sandbox" layout={layout} source={sources?.sandboxMode}>
        <ChoicePicker
          aria-label="Sandbox"
          value={resetFields?.includes('sandboxMode') ? 'access-mode' : (value.sandboxMode ?? '')}
          disabled={disabled || !supported}
          onValueChange={(sandboxMode) =>
            sandboxMode === 'access-mode'
              ? onResetField?.('sandboxMode')
              : onChange(
                  {
                    approvalPolicy: value.approvalPolicy,
                    sandboxMode: sandboxMode ? decode(sandboxModeSchema, sandboxMode) : undefined,
                  },
                  'sandboxMode',
                )
          }
        >
          {onResetField && <option value="access-mode">From access mode</option>}
          <option value="">
            {inherited?.sandboxMode
              ? `Inherit (${sandboxModeNames[inherited.sandboxMode]})`
              : 'Inherit from access mode'}
          </option>
          {sandboxModeSchema.literals.map((id) => (
            <option key={id} value={id} disabled={!capabilities.sandboxModes.includes(id)}>
              {sandboxModeNames[id]}
              {capabilities.sandboxModes.includes(id) ? '' : ' · Not supported'}
            </option>
          ))}
        </ChoicePicker>
        <p className="text-xs font-normal text-muted-foreground">
          {capabilities.sandboxDescription}
        </p>
      </PolicyField>
      {!supported && (
        <p role="status" className="text-xs text-muted-foreground">
          {permissionPolicyUpdateMessage}
        </p>
      )}
      {issue && (
        <p role="alert" className="text-xs text-destructive">
          {issue}. Clear the override to inherit.
        </p>
      )}
      {supported && effective.readOnly && (
        <p className="text-xs text-muted-foreground">
          Read-only access takes precedence over approval and sandbox overrides.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Wider access applies on the next turn. Tightening access stops affected running agents.
      </p>
    </details>
  )
}

function PolicyField({
  label,
  layout,
  source,
  children,
}: {
  label: string
  layout?: 'settings'
  source?: ReactNode
  children: ReactNode
}) {
  return layout === 'settings' ? (
    <SettingRow label={label} source={source}>
      <div className="w-full space-y-2">{children}</div>
    </SettingRow>
  ) : (
    <FormField label={label}>{children}</FormField>
  )
}
