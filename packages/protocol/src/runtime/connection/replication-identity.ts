/** Restore generations change the journal actor, never the paired runtime identity. */
export function runtimeStateSource(runtimeId: string, generation?: string) {
  return generation ? `${runtimeId}:restore:${generation}` : runtimeId
}
export function isRuntimeStateSource(source: string, runtimeId: string) {
  return (
    source === runtimeId ||
    (source.startsWith(`${runtimeId}:restore:`) &&
      /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
        source.slice(runtimeId.length + 9),
      ))
  )
}
