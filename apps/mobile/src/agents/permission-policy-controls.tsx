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
import { permissionPolicyUpdateMessage } from './permission-policy'
export { permissionPolicyUIIssue } from './permission-policy'
import { View, Pressable } from 'react-native'
import { useState } from 'react'
import { SettingsChoice as Choice } from '../screens/settings-controls'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'

const approvalNames = {
  untrusted: 'Untrusted commands',
  'on-failure': 'On failure',
  'on-request': 'On request',
  never: 'Never',
}
const sandboxNames = {
  'read-only': 'Read only',
  'workspace-write': 'Workspace write',
  'danger-full-access': 'Full access',
}
export function PermissionPolicyControls({
  value,
  supported,
  disabled,
  onChange,
  inherited,
  onReset,
  resetFields,
  onResetField,
}: {
  value: PermissionPolicy
  supported: boolean
  disabled?: boolean
  onChange: (
    value: Pick<PermissionPolicy, 'approvalPolicy' | 'sandboxMode'>,
    field?: 'approvalPolicy' | 'sandboxMode',
  ) => void
  inherited?: Pick<PermissionPolicy, 'approvalPolicy' | 'sandboxMode'>
  onReset?: () => void
  resetFields?: readonly ('approvalPolicy' | 'sandboxMode')[]
  onResetField?: (field: 'approvalPolicy' | 'sandboxMode') => void
}) {
  const { styles } = useTheme()
  const [expanded, setExpanded] = useState(false)
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
    <View style={{ gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
      >
        <Text style={styles.muted}>Advanced · {permissionPolicyLabel(displayed)}</Text>
      </Pressable>
      {expanded && (
        <>
          <Text style={styles.muted}>{permissionPolicySummary(displayed)}</Text>
          {(value.approvalPolicy ||
            value.sandboxMode ||
            inherited?.approvalPolicy ||
            inherited?.sandboxMode) && (
            <Pressable
              accessibilityRole="button"
              disabled={disabled || !supported}
              onPress={() =>
                onReset
                  ? onReset()
                  : onChange({ approvalPolicy: undefined, sandboxMode: undefined })
              }
            >
              <Text>Reset to access mode</Text>
            </Pressable>
          )}
          <Choice
            row
            label="Approval policy"
            value={
              resetFields?.includes('approvalPolicy') ? 'access-mode' : (value.approvalPolicy ?? '')
            }
            disabled={disabled || !supported}
            items={[
              ...(onResetField ? [{ id: 'access-mode', name: 'From access mode' }] : []),
              {
                id: '',
                name: inherited?.approvalPolicy
                  ? `Inherit (${approvalNames[inherited.approvalPolicy]})`
                  : 'Inherit from access mode',
              },
              ...approvalPolicySchema.literals.map((id) => ({
                id,
                name: `${approvalNames[id]}${capabilities.approvalPolicies.includes(id) ? '' : ' · Not supported'}`,
                disabled: !capabilities.approvalPolicies.includes(id),
              })),
            ]}
            onChange={(approvalPolicy) =>
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
          />
          <Text style={styles.muted}>{capabilities.approvalDescription}</Text>
          <Choice
            row
            label="Sandbox"
            value={resetFields?.includes('sandboxMode') ? 'access-mode' : (value.sandboxMode ?? '')}
            disabled={disabled || !supported}
            items={[
              ...(onResetField ? [{ id: 'access-mode', name: 'From access mode' }] : []),
              {
                id: '',
                name: inherited?.sandboxMode
                  ? `Inherit (${sandboxNames[inherited.sandboxMode]})`
                  : 'Inherit from access mode',
              },
              ...sandboxModeSchema.literals.map((id) => ({
                id,
                name: `${sandboxNames[id]}${capabilities.sandboxModes.includes(id) ? '' : ' · Not supported'}`,
                disabled: !capabilities.sandboxModes.includes(id),
              })),
            ]}
            onChange={(sandboxMode) =>
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
          />
          <Text style={styles.muted}>{capabilities.sandboxDescription}</Text>
          {!supported && (
            <Text accessibilityRole="alert" style={styles.muted}>
              {permissionPolicyUpdateMessage}
            </Text>
          )}
          {issue && (
            <Text accessibilityRole="alert" style={styles.error}>
              {issue}. Clear the override to inherit.
            </Text>
          )}
          {supported && effective.readOnly && (
            <Text style={styles.muted}>
              Read-only access takes precedence over approval and sandbox overrides.
            </Text>
          )}
          <Text style={styles.muted}>
            Wider access applies on the next turn. Tightening access stops affected running agents.
          </Text>
        </>
      )}
    </View>
  )
}
