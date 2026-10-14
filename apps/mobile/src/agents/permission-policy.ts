import { permissionPolicyIssue, type PermissionPolicy } from '@dovo/protocol'

export const permissionPolicyUpdateMessage =
  'Update this runtime to use separate approval and sandbox controls. Saved overrides are kept.'

/** Block save/launch when an older runtime would discard explicit restrictions. */
export function permissionPolicyUIIssue(value: PermissionPolicy, supported: boolean) {
  return !supported && (value.approvalPolicy || value.sandboxMode)
    ? permissionPolicyUpdateMessage
    : permissionPolicyIssue(value)
}
