/** A foreign profile ID is only a hint; stable runtime identity wins after pairing. */
export function resolveThreadRuntime<
  Profile extends {
    id: string
    connection: { runtimeId?: string }
  },
>(
  target: { runtimeId: string | null; runtimeIdentity?: string },
  profiles: readonly Profile[],
  overviews: readonly { profile: { id: string }; snapshot: { runtimeId?: string } | null }[],
): Profile | undefined {
  if (!target.runtimeIdentity) return profiles.find((profile) => profile.id === target.runtimeId)
  return profiles.find((profile) => {
    const identity =
      profile.connection.runtimeId ??
      overviews.find((source) => source.profile.id === profile.id)?.snapshot?.runtimeId
    return identity === target.runtimeIdentity
  })
}
