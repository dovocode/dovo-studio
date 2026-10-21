export type PeerRoute = 'direct' | 'relay'

function report(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined
}

/** Only the selected pair describes traffic. Gathered relay candidates prove nothing. */
export function selectedPeerRoute(stats: ReadonlyMap<unknown, unknown>): PeerRoute | undefined {
  let pair: Record<string, unknown> | undefined
  for (const value of stats.values()) {
    const transport = report(value)
    if (transport?.type === 'transport' && typeof transport.selectedCandidatePairId === 'string') {
      pair = report(stats.get(transport.selectedCandidatePairId))
      if (pair) break
    }
  }
  // Some native reports expose selection on the pair instead of the transport.
  if (!pair) {
    const selected = [...stats.values()]
      .map(report)
      .filter((value) => value?.type === 'candidate-pair' && value.selected === true)
    if (selected.length === 1) pair = selected[0]
  }
  if (pair?.type !== 'candidate-pair' || pair.state !== 'succeeded') return undefined
  const local = report(stats.get(pair.localCandidateId))
  const remote = report(stats.get(pair.remoteCandidateId))
  if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') return 'relay'
  const direct = (candidate: Record<string, unknown> | undefined) =>
    ['host', 'srflx', 'prflx'].some((type) => candidate?.candidateType === type)
  return direct(local) && direct(remote) ? 'direct' : undefined
}
