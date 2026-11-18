/** Invalid URLs must never issue a request with a coerced or unsafe PR number. */
export function pullRouteNumber(value: string | string[] | undefined): number | undefined {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}

export function pullRouteDestination(tab: string | string[] | undefined) {
  if (tab === 'agent-review') return { initialTab: 'overview', initialAgentReview: true } as const
  if (tab === 'overview' || tab === 'changes' || tab === 'checks')
    return { initialTab: tab } as const
  return {}
}
