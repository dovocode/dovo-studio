import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { reviewedToolRounds, reviewedToolCases } from './reviewed-tool-instruction-rounds.mjs'
import { collectReviewedRounds } from './summarize-reviewed-tool-rounds.mjs'

const hash = (text) => createHash('sha256').update(text).digest('hex')
const save = (path, value) => writeFileSync(path, JSON.stringify(value))
function fixture(extras = {}, followup = false) {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-reviewed-summary-'))
  const models = { deepseek: 'test/deepseek', qwen: 'test/qwen', glm: 'test/glm' }
  const catalog = [...new Set(reviewedToolCases.flatMap((t) => t.steps.map((s) => s.tool)))].map(
    (name) => ({ name }),
  )
  const sources = Object.fromEntries(
    ['scripts/tool-quality-round.mjs', 'scripts/model-instruction-cases.mjs'].map((path) => {
      const text = readFileSync(path, 'utf8')
      return [path, { text, hash: hash(text) }]
    }),
  )
  save(join(directory, 'cases.json'), reviewedToolCases)
  const phases = [...Object.entries(reviewedToolRounds), ...(followup ? [['41-followup', []]] : [])]
  for (const [number, planned] of phases) {
    const extra = extras[number] ?? []
    const selected = reviewedToolCases
      .filter((test) => planned.includes(test.id) || extra.includes(test.id))
      .map((test) => test.id)
    const root = join(directory, 'round' + number)
    mkdirSync(root)
    const profiles = { default: number === '37' ? 'before' : 'candidate' }
    save(join(root, 'catalog.json'), catalog)
    save(join(root, 'profiles.json'), profiles)
    const manifest = {
      phase: parseInt(number, 10),
      followup: number === '41-followup',
      startedAt: 'test-start',
      completedAt: 'test-end',
      models,
      selectedCaseIds: selected,
      requestedExtraCaseIds: extra,
      caseHash: hash(JSON.stringify(reviewedToolCases)),
      catalogHash: hash(readFileSync(join(root, 'catalog.json'))),
      instructionHash: hash(JSON.stringify(profiles)),
      sources,
      workers: Object.keys(models).map((key) => ({ key, status: 'fulfilled' })),
      batches: [],
    }
    for (const [key, model] of Object.entries(models))
      for (let i = 0; i < selected.length; i += 8) {
        const requested = selected.slice(i, i + 8)
        const file = key + '-' + i + '.json'
        const raw = {
          model,
          caseHash: manifest.caseHash,
          catalogHash: manifest.catalogHash,
          instructionHash: manifest.instructionHash,
          providerRequestGate: 'shared loopback proxy',
          requested,
          cases: requested.length,
          correct: 0,
          complete: true,
          usageReports: 0,
          reportedTokens: null,
          source: {
            'model-instruction-cases.mjs': sources['scripts/model-instruction-cases.mjs'].text,
          },
          results: requested.map((id) => ({
            id,
            correct: false,
            calls: [],
            error: 'Intentional missing actions',
            nativeAttempts: [],
            toolAttempts: [],
            assistantText: '',
          })),
        }
        save(join(root, file), raw)
        manifest.batches.push({ key, file, requested, code: 0, capped: false })
      }
    save(join(root, 'manifest.json'), manifest)
    const dispatch = {
      startedAt: parseInt(number, 10) * 60000 + (number === '41-followup' ? 60000 : 0),
      method: 'POST',
      path: '/chat/completions',
    }
    save(join(root, 'provider-requests.json'), [{ ...dispatch, status: 200, failed: true }])
    writeFileSync(join(root, 'provider-dispatch.jsonl'), JSON.stringify(dispatch) + '\n')
  }
  return directory
}
function mutate(path, change) {
  const value = JSON.parse(readFileSync(path, 'utf8'))
  change(value)
  save(path, value)
}

await test('summary preserves failed cases, strict scores, cancellations and unknown usage', () => {
  const directory = fixture()
  try {
    const r = collectReviewedRounds(directory)
    assert.equal(r.caseExecutions, 159)
    assert.equal(r.providerGate.requests, 5)
    assert.equal(r.providerGate.httpErrorResponses, 0)
    assert.equal(r.providerGate.connectionErrorFlags, 5)
    assert.deepEqual(r.reviews, [])
    const review = 'Read-only review. Keep the stopped watch stopped.\n'
    writeFileSync(join(directory, 'opus-rewrite-review.md'), review)
    assert.deepEqual(collectReviewedRounds(directory).reviews, [
      { name: 'opus-rewrite-review.md', sha256: hash(review), text: review },
    ])
    for (const round of r.rounds)
      for (const run of round.runs) {
        assert.equal(run.strict, 0)
        assert.equal(run.taskComplete, 0)
        assert.equal(run.reportedTokens, null)
        assert.equal(run.casesWithoutUsage, run.cases)
        assert.equal(run.results[0].error, 'Intentional missing actions')
      }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

await test('summary rejects replaced scores, missing cases and uncaptured instruction changes', () => {
  const directory = fixture()
  try {
    const path = join(directory, 'round38/deepseek-0.json')
    const original = readFileSync(path)
    mutate(path, (raw) => {
      raw.results[0].correct = true
      raw.correct++
    })
    assert.throws(() => collectReviewedRounds(directory), /Strict score mismatch/)
    writeFileSync(path, original)
    mutate(path, (raw) => {
      raw.results.pop()
      raw.cases--
    })
    assert.throws(() => collectReviewedRounds(directory), /Batch totals mismatch/)
    writeFileSync(path, original)
    const root = join(directory, 'round39')
    const catalogPath = join(root, 'catalog.json')
    const originalCatalog = readFileSync(catalogPath)
    mutate(catalogPath, (catalog) => {
      catalog[0].inputSchema = { type: 'object', required: ['newField'] }
    })
    mutate(join(root, 'manifest.json'), (m) => {
      m.catalogHash = hash(readFileSync(catalogPath))
    })
    assert.throws(() => collectReviewedRounds(directory), /Tool contracts changed/)
    writeFileSync(catalogPath, originalCatalog)
    mutate(join(root, 'manifest.json'), (m) => {
      m.catalogHash = hash(originalCatalog)
    })
    save(join(root, 'profiles.json'), { default: 'unrecorded change' })
    mutate(join(root, 'manifest.json'), (m) => {
      m.instructionHash = hash(JSON.stringify({ default: 'unrecorded change' }))
    })
    assert.throws(() => collectReviewedRounds(directory), /Batch input mismatch/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

await test('later rounds accept recorded wording changes without replacing matched scores', () => {
  const directory = fixture()
  try {
    const before = collectReviewedRounds(directory)
    const root = join(directory, 'round39')
    const profiles = { default: 'revised after user feedback' }
    const instructionHash = hash(JSON.stringify(profiles))
    save(join(root, 'profiles.json'), profiles)
    mutate(join(root, 'manifest.json'), (manifest) => {
      manifest.instructionHash = instructionHash
      for (const batch of manifest.batches)
        mutate(join(root, batch.file), (raw) => {
          raw.instructionHash = instructionHash
        })
    })
    const after = collectReviewedRounds(directory)
    assert.deepEqual(after.matched, before.matched)
    assert.deepEqual(after.rounds[0], before.rounds[0])
    assert.deepEqual(after.rounds[1], before.rounds[1])
    assert.deepEqual(after.rounds[2].profiles, profiles)
    assert.equal(after.caseExecutions, before.caseExecutions)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

await test('later retests preserve the full planned coverage and earlier attempts', () => {
  const directory = fixture({ 39: ['bot-skill-proposal'] })
  try {
    const report = collectReviewedRounds(directory)
    assert.equal(report.caseExecutions, 162)
    assert.deepEqual(report.rounds[2].requestedExtraCaseIds, ['bot-skill-proposal'])
    assert.ok(report.rounds[2].selectedCaseIds.includes('bot-skill-proposal'))
    assert.equal(
      report.rounds[1].runs[0].results.filter((r) => r.id === 'bot-skill-proposal').length,
      1,
    )
    mutate(join(directory, 'round39/manifest.json'), (m) => {
      m.requestedExtraCaseIds = ['unknown-case']
    })
    assert.throws(() => collectReviewedRounds(directory), /Invalid extra cases/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

await test('a final wording follow-up stays separate from the five rounds', () => {
  const directory = fixture({ '41-followup': ['signed-in-tab-snapshot'] }, true)
  try {
    const report = collectReviewedRounds(directory)
    assert.equal(report.caseExecutions, 162)
    assert.equal(report.rounds.length, 6)
    assert.equal(report.rounds.filter((round) => !round.followup).length, 5)
    assert.deepEqual(report.rounds.at(-1).selectedCaseIds, ['signed-in-tab-snapshot'])
    assert.equal(report.rounds.at(-1).followup, true)
    assert.equal(report.rounds.at(-2).followup, false)
    mutate(join(directory, 'round41-followup/manifest.json'), (m) => {
      m.followup = false
    })
    assert.throws(() => collectReviewedRounds(directory), /Follow-up kind mismatch/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

await test('records description-only batch drift and rejects changed validation code', () => {
  const directory = fixture()
  try {
    const path = 'packages/runtime/dist/studio/tool-definitions.js'
    const before = "const tool = { description: 'Read/test signed-in Dovo tabs. Snapshot.' };\n"
    const after = "const tool = { description: 'Read/test signed-in Dovo tabs. Read facts.' };\n"
    for (const number of Object.keys(reviewedToolRounds))
      mutate(join(directory, 'round' + number, 'manifest.json'), (m) => {
        m.sources[path] = { text: before, hash: hash(before) }
      })
    const batch = join(directory, 'round41/deepseek-0.json')
    mutate(batch, (raw) => {
      raw.source['tool-definitions.js'] = after
    })
    const report = collectReviewedRounds(directory)
    const recorded = report.rounds.at(-1).runs[0].batches[0]
    assert.equal(recorded.sourceDrift.length, 1)
    assert.equal(recorded.sourceRefs['tool-definitions.js'], hash(after))
    assert.equal(report.sources[hash(after)].text, after)
    assert.equal(recorded.sourceDrift[0].phaseSnapshotHash, hash(before))
    mutate(batch, (raw) => {
      raw.source['tool-definitions.js'] = after + 'export const validationChanged = true;\n'
    })
    assert.throws(() => collectReviewedRounds(directory), /Batch source mismatch/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
