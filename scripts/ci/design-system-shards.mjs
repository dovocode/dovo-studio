/**
 * Shard planning for the design-system browser check.
 *
 * The full catalog run covers every story in both palettes at phone and desktop widths, plus the
 * hosted inner-frame matrix, plus one pass of catalog interactions. CI splits the two matrices over
 * several jobs; each job owns a disjoint slice and the slices together cover every case exactly
 * once. Interactions are not a matrix, so they run once: either in the browser job
 * (`DOVO_DESIGN_INTERACTIONS_ONLY=1`) or on one chosen shard (`DOVO_DESIGN_INTERACTIONS=1`).
 *
 * Selection interface (command line wins over the environment):
 *   node scripts/check-design-system-browser.mjs [shard] [count]
 *   DOVO_DESIGN_SHARD=<index> DOVO_DESIGN_SHARD_COUNT=<count>
 *   DOVO_DESIGN_INTERACTIONS_ONLY=1      interactions only, never combined with sharding
 *   DOVO_DESIGN_INTERACTIONS=1|0         force interactions on or off for this run
 */
export const designThemes = Object.freeze(['dark', 'light'])
export const designWidths = Object.freeze([390, 1280])

const usage =
  'Usage: node scripts/check-design-system-browser.mjs [shard] [count] ' +
  '(or DOVO_DESIGN_SHARD=<index> DOVO_DESIGN_SHARD_COUNT=<count>)'

const flag = (value) => {
  if (value === undefined || value === '') return undefined
  if (['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())) return true
  if (['0', 'false', 'no', 'off'].includes(String(value).toLowerCase())) return false
  throw new Error(`Expected 1 or 0, received ${JSON.stringify(value)}`)
}

const integer = (value, label) => {
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new Error(`${label} must be a whole number. ${usage}`)
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) throw new Error(`${label} must be a whole number. ${usage}`)
  return Number(text)
}

/** Validate a shard index and count pair; counts of one mean an unsharded run. */
export function validateShard({ shard, count }) {
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error(`Shard count must be a whole number of at least 1, received ${count}. ${usage}`)
  if (!Number.isSafeInteger(shard) || shard < 0 || shard >= count)
    throw new Error(`Shard index must be between 0 and ${count - 1}, received ${shard}. ${usage}`)
  return { shard, count }
}

/** Read the shard selection from positional arguments first, then the environment. */
export function parseShardSelection({ env = {}, argv = [] } = {}) {
  if (argv.length > 2) throw new Error(`Unexpected arguments: ${argv.slice(2).join(' ')}. ${usage}`)
  if (argv.length === 1)
    throw new Error(`A shard index needs a shard count as the second argument. ${usage}`)
  if (argv.length === 2)
    return {
      ...validateShard({
        shard: integer(argv[0], 'Shard index'),
        count: integer(argv[1], 'Shard count'),
      }),
      source: 'argv',
    }
  const shardText = env.DOVO_DESIGN_SHARD,
    countText = env.DOVO_DESIGN_SHARD_COUNT
  const hasShard = shardText !== undefined && shardText !== '',
    hasCount = countText !== undefined && countText !== ''
  if (hasShard !== hasCount)
    throw new Error('DOVO_DESIGN_SHARD and DOVO_DESIGN_SHARD_COUNT must be set together. ' + usage)
  if (!hasShard) return { shard: 0, count: 1, source: 'default' }
  return {
    ...validateShard({
      shard: integer(shardText, 'DOVO_DESIGN_SHARD'),
      count: integer(countText, 'DOVO_DESIGN_SHARD_COUNT'),
    }),
    source: 'env',
  }
}

/**
 * Decide what one invocation runs.
 *
 * - Unsharded, no flags: full matrix, full hosted matrix and interactions (local full run).
 * - `DOVO_DESIGN_INTERACTIONS_ONLY=1`: interactions only; sharding is rejected so the interactions
 *   cannot silently repeat on every shard.
 * - Sharded: this shard's matrix slices; interactions are skipped unless
 *   `DOVO_DESIGN_INTERACTIONS=1` names this run as the single interactions pass.
 */
export function resolveDesignPlan({ env = {}, argv = [] } = {}) {
  const { shard, count, source } = parseShardSelection({ env, argv })
  const interactionsOnly = flag(env.DOVO_DESIGN_INTERACTIONS_ONLY) ?? false
  const interactionsFlag = flag(env.DOVO_DESIGN_INTERACTIONS)
  if (interactionsOnly && count > 1)
    throw new Error(
      'DOVO_DESIGN_INTERACTIONS_ONLY runs the catalog interactions exactly once and cannot be sharded; ' +
        'drop the shard selection or use DOVO_DESIGN_INTERACTIONS=1 on a single shard instead.',
    )
  if (interactionsOnly && interactionsFlag === false)
    throw new Error('DOVO_DESIGN_INTERACTIONS_ONLY=1 conflicts with DOVO_DESIGN_INTERACTIONS=0.')
  const matrix = !interactionsOnly
  const interactions = interactionsOnly || (interactionsFlag ?? count === 1)
  if (!matrix && !interactions) throw new Error('Nothing to run: matrix and interactions disabled.')
  return { shard, count, source, matrix, interactions, interactionsOnly }
}

/** Every story/theme/viewport case in the canonical order the sequential run used. */
export function designMatrixCases(stories, { themes = designThemes, widths = designWidths } = {}) {
  const cases = []
  for (const mode of themes)
    for (const width of widths) for (const story of stories) cases.push({ story, mode, width })
  return cases
}

/** Every hosted entry/theme/viewport case in the canonical order the sequential run used. */
export function hostedMatrixCases(entries, { themes = designThemes, widths = designWidths } = {}) {
  const cases = []
  for (const width of widths)
    for (const theme of themes) for (const entry of entries) cases.push({ entry, theme, width })
  return cases
}

/**
 * Keep the cases this shard owns. Round-robin assignment keeps every shard's mix of themes,
 * widths and stories similar, so the slowest shard stays close to the average.
 */
export function shardCases(cases, selection) {
  const { shard, count } = validateShard(selection)
  return cases.filter((_, index) => index % count === shard)
}

/** Stable identity for a case so coverage can be compared across shards. */
export function caseKey(item) {
  const id = item.story?.id ?? item.entry?.id
  return `${id}|${item.mode ?? item.theme}|${item.width}`
}

/** Assert that the shard slices partition the cases: disjoint, exhaustive and in input order. */
export function assertPartition(cases, count) {
  const seen = new Map()
  for (let shard = 0; shard < count; shard++)
    for (const item of shardCases(cases, { shard, count })) {
      const key = caseKey(item)
      if (seen.has(key))
        throw new Error(`${key} is assigned to shards ${seen.get(key)} and ${shard}`)
      seen.set(key, shard)
    }
  const missing = cases.map(caseKey).filter((key) => !seen.has(key))
  if (missing.length) throw new Error(`Cases without a shard: ${missing.join(', ')}`)
  if (seen.size !== cases.length)
    throw new Error(`Expected ${cases.length} unique cases, saw ${seen.size}`)
  return seen
}

export function describeShard({ shard, count }) {
  return count > 1 ? `shard ${shard + 1} of ${count}` : 'unsharded run'
}

export function describePlan(plan) {
  const parts = []
  if (plan.matrix) parts.push(`story and hosted matrix (${describeShard(plan)})`)
  if (plan.interactions) parts.push('catalog interactions')
  return `Design-system check: ${parts.join(' + ')}.`
}
