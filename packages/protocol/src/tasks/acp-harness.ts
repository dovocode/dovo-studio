import type { AcpInstallation } from '../auth/acp-registry.js'
import { defaultTaskHarness, type TaskHarness } from '../workspace.js'

export const acpHarnessChoiceId = (id: string) => `acp:${id}`

export function isAntigravityAcp(
  installationId: string | undefined,
  command: string,
  args: readonly string[],
) {
  return (
    installationId === 'antigravity-acp' ||
    (/^agy(?:\.exe|\.cmd)?$/i.test(command.split(/[\\/]/).at(-1) ?? '') && args.includes('acp'))
  )
}

export function isAntigravityHarness(harness: TaskHarness | undefined) {
  return (
    harness?.provider === 'acp' &&
    isAntigravityAcp(
      harness.acpInstallationId,
      harness.executablePath || harness.endpoint,
      harness.args ?? [],
    )
  )
}

export function acpInstallationHarness(
  installation: AcpInstallation,
  permission: TaskHarness['permission'] = 'full-access',
): TaskHarness {
  return {
    ...defaultTaskHarness('acp'),
    acpInstallationId: installation.id,
    permission,
  }
}

export function acpHarnessName(
  harness: Pick<TaskHarness, 'provider' | 'acpInstallationId'>,
  installations: readonly AcpInstallation[],
) {
  return harness.provider === 'acp' && harness.acpInstallationId
    ? (installations.find((entry) => entry.id === harness.acpInstallationId)?.name ??
        harness.acpInstallationId)
    : undefined
}
