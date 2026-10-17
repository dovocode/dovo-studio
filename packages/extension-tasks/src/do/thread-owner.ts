import type { RuntimeProfile, RuntimeSnapshot } from '@dovo/protocol'

type Computer = {
  profile: RuntimeProfile
  snapshot?: Pick<RuntimeSnapshot, 'runtimeId'> | null
}

/** Plans store runtime identities; each client has its own IDs for saved profiles. */
export function doThreadOwner(
  computers: readonly Computer[],
  originProfileId: string,
  targetRuntimeId: string,
): RuntimeProfile | undefined {
  if (targetRuntimeId === 'local')
    return computers.find((computer) => computer.profile.id === originProfileId)?.profile
  return (
    computers.find(
      (computer) =>
        (computer.snapshot?.runtimeId ?? computer.profile.connection.runtimeId) === targetRuntimeId,
    )?.profile ??
    // Older saved plans may refer to the owner's client-specific profile ID.
    computers.find((computer) => computer.profile.id === targetRuntimeId)?.profile
  )
}
