/** Task identity includes its owning computer; task IDs can collide across runtimes. */
export function taskHref(runtimeId: string, taskId: string) {
  return {
    pathname: '/(tasks)/thread/[runtimeId]/[taskId]' as const,
    params: { runtimeId, taskId },
  }
}
