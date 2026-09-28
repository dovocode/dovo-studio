/** Providers use null, empty strings or zero dates for work that has not started/finished. */
export function pipelineTime(value: string | null | undefined) {
  return value && Number.isFinite(Date.parse(value)) && Date.parse(value) > 0 ? value : undefined
}

/** Keep structured provider diagnostics small; the provider remains the source for full logs. */
export function pipelineErrors(values: readonly string[] | undefined) {
  const messages = values
    ?.map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 10)
  return messages?.length
    ? messages.map((value) => (value.length > 2000 ? `${value.slice(0, 1999)}…` : value))
    : undefined
}
