import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  assertPartition,
  caseKey,
  describePlan,
  describeShard,
  designMatrixCases,
  designThemes,
  designWidths,
  hostedMatrixCases,
  parseShardSelection,
  resolveDesignPlan,
  shardCases,
} from './design-system-shards.mjs'

const stories = Array.from({ length: 280 }, (_, index) => ({
  id: `dovo-story--case-${index}`,
  title: index < 42 ? 'Dovo/Screens/Hosted' : 'Dovo/Primitives',
  type: 'story',
}))
const hosted = stories.filter((story) => story.title === 'Dovo/Screens/Hosted')

void test('expands the catalog into the full story/theme/viewport and hosted matrices', () => {
  const matrix = designMatrixCases(stories)
  assert.equal(matrix.length, 1120)
  assert.deepEqual(matrix[0], { story: stories[0], mode: 'dark', width: 390 })
  assert.deepEqual(matrix.at(-1), { story: stories.at(-1), mode: 'light', width: 1280 })
  const hostedMatrix = hostedMatrixCases(hosted)
  assert.equal(hostedMatrix.length, 168)
  assert.deepEqual(hostedMatrix[0], { entry: hosted[0], theme: 'dark', width: 390 })
  assert.deepEqual(hostedMatrix.at(-1), { entry: hosted.at(-1), theme: 'light', width: 1280 })
  assert.deepEqual([...designThemes], ['dark', 'light'])
  assert.deepEqual([...designWidths], [390, 1280])
  assert.equal(new Set(matrix.map(caseKey)).size, 1120, 'Every matrix case has a distinct key')
  assert.equal(new Set(hostedMatrix.map(caseKey)).size, 168)
})

void test('shards partition both matrices disjointly, exhaustively and evenly', () => {
  for (const cases of [designMatrixCases(stories), hostedMatrixCases(hosted)])
    for (const count of [1, 2, 3, 4, 5, 7, 8]) {
      const owners = assertPartition(cases, count)
      const sizes = Array.from({ length: count }, (_, shard) => shardCases(cases, { shard, count }))
      assert.equal(
        sizes.reduce((total, slice) => total + slice.length, 0),
        cases.length,
        `${count} shards cover every case once`,
      )
      const lengths = sizes.map((slice) => slice.length)
      assert.ok(Math.max(...lengths) - Math.min(...lengths) <= 1, `${count} shards stay balanced`)
      assert.ok(Math.min(...lengths) > 0, `${count} shards each own work`)
      for (const [shard, slice] of sizes.entries())
        for (const item of slice) assert.equal(owners.get(caseKey(item)), shard)
      // Shards keep the canonical order, so progress logs line up with the sequential run.
      for (const slice of sizes) {
        const positions = slice.map((item) => cases.indexOf(item))
        assert.deepEqual(
          positions,
          [...positions].sort((a, b) => a - b),
        )
      }
    }
  const four = Array.from({ length: 4 }, (_, shard) =>
    shardCases(designMatrixCases(stories), { shard, count: 4 }),
  )
  assert.deepEqual(
    four.map((slice) => slice.length),
    [280, 280, 280, 280],
  )
  for (const slice of four) {
    assert.equal(new Set(slice.map((item) => item.mode)).size, 2, 'both themes in every shard')
    assert.equal(new Set(slice.map((item) => item.width)).size, 2, 'both widths in every shard')
  }
})

void test('an unsharded selection is identical to the whole matrix', () => {
  const cases = designMatrixCases(stories)
  assert.deepEqual(shardCases(cases, { shard: 0, count: 1 }), cases)
})

void test('assertPartition reports duplicated and missing coverage', () => {
  const cases = hostedMatrixCases(hosted)
  assert.throws(
    () => assertPartition([...cases, cases[0]], 2),
    /is assigned to shards/,
    'duplicate cases are rejected',
  )
  assert.doesNotThrow(() => assertPartition(cases, 168))
})

void test('reads the shard selection from positional arguments or the environment', () => {
  assert.deepEqual(parseShardSelection(), { shard: 0, count: 1, source: 'default' })
  assert.deepEqual(parseShardSelection({ argv: ['2', '4'] }), {
    shard: 2,
    count: 4,
    source: 'argv',
  })
  assert.deepEqual(
    parseShardSelection({ env: { DOVO_DESIGN_SHARD: '3', DOVO_DESIGN_SHARD_COUNT: '4' } }),
    { shard: 3, count: 4, source: 'env' },
  )
  assert.deepEqual(
    parseShardSelection({
      env: { DOVO_DESIGN_SHARD: '3', DOVO_DESIGN_SHARD_COUNT: '4' },
      argv: ['0', '2'],
    }),
    { shard: 0, count: 2, source: 'argv' },
    'command line wins over the environment',
  )
  assert.deepEqual(
    parseShardSelection({ env: { DOVO_DESIGN_SHARD: '', DOVO_DESIGN_SHARD_COUNT: '' } }),
    { shard: 0, count: 1, source: 'default' },
    'empty values mean unset',
  )
})

void test('rejects invalid shard selections', () => {
  for (const argv of [
    ['1'],
    ['0', '4', 'extra'],
    ['a', '4'],
    ['-1', '4'],
    ['1.5', '4'],
    ['0', '0'],
  ])
    assert.throws(() => parseShardSelection({ argv }), /shard|Unexpected/i, argv.join(' '))
  for (const argv of [
    ['4', '4'],
    ['5', '4'],
  ])
    assert.throws(() => parseShardSelection({ argv }), /between 0 and 3/)
  assert.throws(
    () => parseShardSelection({ env: { DOVO_DESIGN_SHARD: '1' } }),
    /must be set together/,
  )
  assert.throws(
    () => parseShardSelection({ env: { DOVO_DESIGN_SHARD_COUNT: '4' } }),
    /must be set together/,
  )
  assert.throws(
    () => parseShardSelection({ env: { DOVO_DESIGN_SHARD: 'x', DOVO_DESIGN_SHARD_COUNT: '4' } }),
    /whole number/,
  )
  assert.throws(() => shardCases([], { shard: 0, count: Number.NaN }), /at least 1/)
  assert.throws(() => shardCases([], { shard: 2, count: 2 }), /between 0 and 1/)
})

void test('plans a local unsharded run as the full matrix plus interactions', () => {
  const plan = resolveDesignPlan()
  assert.deepEqual(plan, {
    shard: 0,
    count: 1,
    source: 'default',
    matrix: true,
    interactions: true,
    interactionsOnly: false,
  })
  assert.equal(describeShard(plan), 'unsharded run')
  assert.equal(
    describePlan(plan),
    'Design-system check: story and hosted matrix (unsharded run) + catalog interactions.',
  )
  const matrixOnly = resolveDesignPlan({ env: { DOVO_DESIGN_INTERACTIONS: '0' } })
  assert.equal(matrixOnly.matrix, true)
  assert.equal(matrixOnly.interactions, false)
})

void test('plans the interactions-only mode used by the browser job', () => {
  const plan = resolveDesignPlan({ env: { DOVO_DESIGN_INTERACTIONS_ONLY: '1' } })
  assert.equal(plan.matrix, false)
  assert.equal(plan.interactions, true)
  assert.equal(plan.interactionsOnly, true)
  assert.equal(plan.count, 1)
  assert.equal(describePlan(plan), 'Design-system check: catalog interactions.')
  assert.equal(resolveDesignPlan({ env: { DOVO_DESIGN_INTERACTIONS_ONLY: '0' } }).matrix, true)
  assert.throws(
    () =>
      resolveDesignPlan({
        env: { DOVO_DESIGN_INTERACTIONS_ONLY: '1', DOVO_DESIGN_INTERACTIONS: '0' },
      }),
    /conflicts/,
  )
})

void test('sharded runs cover their matrix slice and run interactions only when nominated', () => {
  const env = { DOVO_DESIGN_SHARD: '1', DOVO_DESIGN_SHARD_COUNT: '4' }
  const plan = resolveDesignPlan({ env })
  assert.equal(plan.matrix, true)
  assert.equal(plan.interactions, false, 'shards skip interactions by default')
  assert.equal(describePlan(plan), 'Design-system check: story and hosted matrix (shard 2 of 4).')
  const primary = resolveDesignPlan({ env: { ...env, DOVO_DESIGN_INTERACTIONS: '1' } })
  assert.equal(primary.interactions, true, 'one shard can be nominated for interactions')
  assert.equal(primary.matrix, true)
  assert.throws(
    () => resolveDesignPlan({ env: { ...env, DOVO_DESIGN_INTERACTIONS_ONLY: '1' } }),
    /cannot be sharded/,
  )
  assert.throws(() => resolveDesignPlan({ env: { DOVO_DESIGN_INTERACTIONS: 'maybe' } }), /1 or 0/)
  const viaArgs = resolveDesignPlan({ argv: ['3', '4'] })
  assert.deepEqual([viaArgs.shard, viaArgs.count, viaArgs.interactions], [3, 4, false])
})

const builtIndex = new URL('../../apps/design-system/storybook-static/index.json', import.meta.url)
void test(
  'the built catalog partitions into four shards without gaps',
  { skip: !existsSync(builtIndex) && 'storybook-static is not built' },
  () => {
    const index = JSON.parse(readFileSync(builtIndex, 'utf8'))
    const built = Object.values(index.entries).filter((item) => item.type === 'story')
    const hostedBuilt = built.filter((item) => item.title === 'Dovo/Screens/Hosted')
    const matrix = designMatrixCases(built)
    const hostedMatrix = hostedMatrixCases(hostedBuilt)
    assert.ok(matrix.length >= 45 * 4)
    assert.ok(hostedMatrix.length >= 42 * 4)
    assertPartition(matrix, 4)
    assertPartition(hostedMatrix, 4)
  },
)
