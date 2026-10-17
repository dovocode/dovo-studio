/** Plan IDs belong to a runtime. Use the phone's profile ID, as with taskHref. */
export function doPlansHref(runtimeId: string, runId?: string) {
  return {
    pathname: '/settings/do-plans' as const,
    params: { runtimeId, ...(runId ? { runId } : {}) },
  }
}
