import { readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

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

/** Package-local browser regressions must be scheduled just like top-level checks. */
export function unregisteredBrowserChecks(root, scripts) {
  const files = readdirSync(join(root, 'scripts'))
    .filter((file) => /^check-.*-browser\.mjs$/.test(file))
    .map((file) => `scripts/${file}`)
  for (const area of ['apps', 'packages'])
    for (const workspace of readdirSync(join(root, area), { withFileTypes: true })) {
      if (!workspace.isDirectory()) continue
      const src = join(root, area, workspace.name, 'src')
      if (!existsSync(src)) continue
      for (const file of readdirSync(src, { recursive: true }))
        if (file.endsWith('.browser.mjs'))
          files.push(relative(root, join(src, file)).replaceAll('\\', '/'))
    }
  const referenced = Object.entries(scripts)
    .filter(([name]) => /^test:.+:browser$/.test(name))
    .map(([, script]) => script)
    .join('\n')
  return files.filter((file) => !referenced.includes(file)).sort()
}
