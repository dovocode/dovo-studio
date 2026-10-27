// Longest-first scheduling balances measured execution time, with deterministic
// ties and a median estimate for newly registered suites. Every suite runs once.
/**
 * @param {string[]} suites
 * @param {number} count
 * @param {Record<string, number>} durations
 * @returns {{suites: string[], seconds: number}[]}
 */
export function browserShards(suites, count, durations) {
  if (!Number.isInteger(count) || count < 1)
    throw new Error('Shard count must be a positive integer')
  if (new Set(suites).size !== suites.length) throw new Error('Duplicate browser suite')
  const measured = Object.values(durations)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
  const fallback = measured[Math.floor(measured.length / 2)] ?? 10
  const duration = (name) =>
    Number.isFinite(durations[name]) && durations[name] > 0 ? durations[name] : fallback
  const shards = Array.from({ length: count }, () => ({ suites: [], seconds: 0 }))
  for (const name of [...suites].sort((a, b) => duration(b) - duration(a) || a.localeCompare(b))) {
    const next = shards.reduce((least, shard) => (shard.seconds < least.seconds ? shard : least))
    next.suites.push(name)
    next.seconds += duration(name)
  }
  return shards
}

export function browserChecks(script) {
  // pnpm build prepares every workspace package before suites start. Strip only
  // known build commands; leave generators and every actual check in place.
  return script
    .split(' && ')
    .filter(
      (command) =>
        command !== 'pnpm design:build' &&
        !/^pnpm (?:--filter [\w@/.*^-]+ )+(?:-r )?build$/.test(command),
    )
    .join(' && ')
}
