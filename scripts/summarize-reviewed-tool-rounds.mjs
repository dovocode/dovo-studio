import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reviewedToolRounds, reviewedToolCases } from './reviewed-tool-instruction-rounds.mjs'
import { scoreToolQuality } from './tool-quality-round.mjs'
import { compareQuality, requestEvidence } from './summarize-tool-quality-round.mjs'

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const hash = (value) => createHash('sha256').update(value).digest('hex')
function withoutBrowserDescription(source) {
  let matches = 0
  const normalized = source.replace(/description:\s*'Read\/test signed-in Dovo[^'\n]*'/g, () => {
    matches++
    return "description: '<browser-description>'"
  })
  return matches === 1 ? normalized : null
}
export function collectReviewedRounds(directory) {
  const cases = read(join(directory, 'cases.json'))
  if (JSON.stringify(cases) !== JSON.stringify(reviewedToolCases)) throw Error('Case mismatch')
  const rounds = [],
    sources = {},
    requests = [],
    dispatches = []
  let baseline
  const phases = Object.entries(reviewedToolRounds).map(([number, planned]) => ({
    number: Number(number),
    planned,
    followup: false,
  }))
  if (existsSync(join(directory, 'round41-followup/manifest.json')))
    phases.push({ number: 41, planned: [], followup: true })
  for (const { number, planned, followup } of phases) {
    const root = join(directory, 'round' + number + (followup ? '-followup' : '')),
      manifest = read(join(root, 'manifest.json'))
    if (
      !manifest.completedAt ||
      manifest.workers?.length !== 3 ||
      manifest.workers.some((w) => w.status !== 'fulfilled')
    )
      throw Error('Incomplete round ' + number)
    if (!!manifest.followup !== followup) throw Error('Follow-up kind mismatch')
    const extra = manifest.requestedExtraCaseIds ?? []
    if (
      !Array.isArray(extra) ||
      (followup && !extra.length) ||
      (Number(number) < 39 && extra.length) ||
      new Set(extra).size !== extra.length ||
      extra.some((id) => !cases.some((test) => test.id === id))
    )
      throw Error('Invalid extra cases')
    const selected = cases
      .filter((test) => planned.includes(test.id) || extra.includes(test.id))
      .map((test) => test.id)
    if (
      manifest.phase !== Number(number) ||
      manifest.caseHash !== hash(JSON.stringify(cases)) ||
      JSON.stringify(selected) !== JSON.stringify(manifest.selectedCaseIds)
    )
      throw Error('Round input mismatch')
    if (!baseline) baseline = manifest
    if (JSON.stringify(manifest.models) !== JSON.stringify(baseline.models))
      throw Error('Model mismatch')
    for (const [path, source] of Object.entries(manifest.sources)) {
      if (hash(source.text) !== source.hash) throw Error('Frozen source mismatch')
      sources[source.hash] = { name: path, text: source.text }
      const instructionChange =
        path === 'packages/runtime/src/agent-tools/server.ts' ||
        path === 'packages/runtime/src/agents/execution/model-tool-instructions.ts' ||
        (Number(number) === 41 &&
          (path === 'packages/runtime/src/studio/tool-definitions.ts' ||
            path === 'packages/runtime/dist/studio/tool-definitions.js'))
      const revisedDriver = Number(number) > 38 && path === 'scripts/run-reviewed-tool-rounds.mjs'
      if (!instructionChange && !revisedDriver && source.hash !== baseline.sources[path]?.hash)
        throw Error('Harness changed between rounds')
    }
    for (const path of ['scripts/tool-quality-round.mjs', 'scripts/model-instruction-cases.mjs'])
      if (hash(readFileSync(path)) !== manifest.sources[path]?.hash)
        throw Error('Use frozen scorer')
    const catalog = read(join(root, 'catalog.json')),
      profiles = read(join(root, 'profiles.json'))
    if (
      catalog.length !== 53 ||
      new Set(catalog.map((tool) => tool.name)).size !== 53 ||
      hash(readFileSync(join(root, 'catalog.json'))) !== manifest.catalogHash ||
      hash(JSON.stringify(profiles)) !== manifest.instructionHash
    )
      throw Error('Catalog/profile mismatch')
    const contracts = (items) =>
      items.map((item) => {
        const { description: _, ...tool } = item
        return tool
      })
    if (
      rounds.length &&
      JSON.stringify(contracts(catalog)) !== JSON.stringify(contracts(rounds[0].catalog))
    )
      throw Error('Tool contracts changed between rounds')
    const runs = []
    for (const [key, model] of Object.entries(manifest.models)) {
      const results = [],
        batches = [],
        seen = new Set(),
        coverage = new Set()
      for (const batch of manifest.batches.filter((b) => b.key === key)) {
        const raw = read(join(root, batch.file))
        const expected = selected.filter((id) => !seen.has(id)).slice(0, 8 - (seen.size % 8))
        if (
          raw.model !== model ||
          raw.caseHash !== manifest.caseHash ||
          raw.catalogHash !== manifest.catalogHash ||
          raw.instructionHash !== manifest.instructionHash ||
          raw.providerRequestGate !== 'shared loopback proxy' ||
          JSON.stringify(raw.requested) !== JSON.stringify(expected) ||
          JSON.stringify(batch.requested) !== JSON.stringify(expected)
        )
          throw Error('Batch input mismatch')
        if (
          raw.cases !== raw.results.length ||
          raw.correct !== raw.results.filter((r) => r.correct).length ||
          raw.complete !== (raw.cases === raw.requested.length) ||
          (!raw.complete && !batch.capped)
        )
          throw Error('Batch totals mismatch')
        if (
          batch.capped &&
          !readFileSync(join(root, batch.file.replace(/\.json$/, '.log')), 'utf8').includes(
            'Reported usage cap reached',
          )
        )
          throw Error('Unconfirmed usage cap')
        for (const result of raw.results) {
          const test = cases.find((t) => t.id === result.id)
          if (!test || !expected.includes(result.id) || seen.has(result.id))
            throw Error('Unexpected/duplicate case')
          const score = scoreToolQuality(
            test,
            result.calls,
            result.error,
            result.assistantText,
            result.nativeAttempts,
            result.toolAttempts,
            raw.workingDirectory,
          )
          if (score.correct !== result.correct) throw Error('Strict score mismatch')
          seen.add(result.id)
          const { calls: _, expected: __, id: ___, ...quality } = score
          results.push({ ...result, quality, taskComplete: score.taskComplete })
          for (const call of result.calls.filter((c) => c.valid && !c.fixtureError))
            coverage.add(call.tool)
        }
        const refs = {},
          sourceDrift = []
        for (const [name, text] of Object.entries(raw.source)) {
          const entry = Object.entries(manifest.sources).find(([path]) => basename(path) === name)
          if (!entry) throw Error('Batch source mismatch')
          const actualHash = hash(text)
          if (actualHash !== entry[1].hash) {
            const original = withoutBrowserDescription(entry[1].text)
            if (
              number !== 41 ||
              entry[0] !== 'packages/runtime/dist/studio/tool-definitions.js' ||
              original === null ||
              withoutBrowserDescription(text) !== original
            )
              throw Error('Batch source mismatch')
            sourceDrift.push({
              name: entry[0],
              phaseSnapshotHash: entry[1].hash,
              batchSnapshotHash: actualHash,
              reason:
                'Rebuild between batches changed only the browser description. All other module bytes match. The offered catalog stayed fixed. Preserve both versions.',
            })
          }
          sources[actualHash] = { name: entry[0], text }
          refs[name] = actualHash
        }
        const { source: _, results: __, ...metadata } = raw
        batches.push({ ...batch, ...metadata, sourceRefs: refs, sourceDrift })
      }
      if (seen.size !== selected.length) throw Error('Missing cases')
      runs.push({
        key,
        model,
        cases: results.length,
        strict: results.filter((r) => r.correct).length,
        taskComplete: results.filter((r) => r.taskComplete).length,
        validCallCoverage: [...coverage].sort((a, b) => a.localeCompare(b)),
        casesWithoutUsage: batches.reduce((n, b) => n + b.cases - b.usageReports, 0),
        reportedTokens: batches.some((b) => b.reportedTokens === null)
          ? null
          : batches.reduce((n, b) => n + b.reportedTokens, 0),
        batches,
        results,
      })
    }
    const ledger = read(join(root, 'provider-requests.json'))
    const dispatched = readFileSync(join(root, 'provider-dispatch.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse)
    if (!ledger.length) throw Error('Missing request ledger')
    const gate = requestEvidence(ledger, dispatched)
    requests.push(...ledger)
    dispatches.push(...dispatched)
    rounds.push({
      number: Number(number),
      followup,
      requestedExtraCaseIds: extra,
      selectedCaseIds: selected,
      startedAt: manifest.startedAt,
      completedAt: manifest.completedAt,
      catalog,
      profiles,
      catalogHash: manifest.catalogHash,
      instructionHash: manifest.instructionHash,
      sourceRefs: Object.fromEntries(Object.entries(manifest.sources).map(([p, s]) => [p, s.hash])),
      providerGate: gate,
      runs,
    })
  }
  const catalog = rounds[1].catalog
  const expected = new Set(cases.flatMap((t) => t.steps.map((s) => s.tool)))
  if (expected.size !== 53 || catalog.some((t) => !expected.has(t.name)))
    throw Error('Incomplete cases')
  const matched = rounds[0].runs.map((r) => ({
    key: r.key,
    ...compareQuality(
      r.results,
      rounds[1].runs.find((s) => s.key === r.key).results,
      reviewedToolRounds[37],
    ),
  }))
  const collector = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  sources[hash(collector)] = { name: 'scripts/summarize-reviewed-tool-rounds.mjs', text: collector }
  const analysisHelper = readFileSync(
    new URL('./summarize-tool-quality-round.mjs', import.meta.url),
    'utf8',
  )
  sources[hash(analysisHelper)] = {
    name: 'scripts/summarize-tool-quality-round.mjs',
    text: analysisHelper,
  }
  const reviews = [
    'opus-review.md',
    'opus-final-review.md',
    'opus-rewrite-review.md',
    'opus-warning-review.md',
  ]
    .filter((name) => existsSync(join(directory, name)))
    .map((name) => {
      const text = readFileSync(join(directory, name), 'utf8')
      return { name, sha256: hash(text), text }
    })
  return {
    method:
      'Five rounds with Opus 5.5 read-only review. Round 37 is baseline; round 38 repeats the same twelve cases after instruction changes. The user then requested description rewrites for failures. Rounds 39-41 retain coverage of 29 other cases and may add declared retests from the same frozen case file. An optional round41-followup separately checks the final context-budget repair. Instructions/catalogs can change between these later rounds; sources and inputs are frozen separately for each. Tool contracts, cases, fixture effects and scoring stay unchanged. All 53 tools offered throughout. Real OpenCode model choices, low variant, simulated tool effects only. Strict scores and separate bounded-verification required-action scores retained. Previously used cases are regression coverage, not held-out tasks. Retests never replace earlier failures. No pooled improvement or general ranking claim.',
    caseExecutions: rounds.flatMap((r) => r.runs).reduce((n, r) => n + r.cases, 0),
    cases,
    models: baseline.models,
    sources,
    reviews,
    rounds,
    matched,
    providerGate: {
      intervalMs: 3500,
      maximumPerRollingMinute: 18,
      providerLimit: 20,
      scope: 'These benchmark workers only.',
      connectionErrorFlagMeaning:
        'Flags include cancellation of completed SSE streams. They do not establish failed model requests.',
      ...requestEvidence(requests, dispatches),
      ledger: requests,
    },
    limits: {
      caseMs: 120000,
      batchMs: 1200000,
      reportedTokenSoftCap: 500000,
      reportedTokenSoftCapScope:
        'Per benchmark process/batch. A continuation process resets the counter. In-flight requests can exceed the cap.',
      missingUsage: 'unknown',
    },
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw Error('Supply directory and new output file')
  const output = resolve(process.argv[3])
  if (existsSync(output)) throw Error('Refuse to replace saved evidence')
  const report = collectReviewedRounds(resolve(process.argv[2]))
  writeFileSync(
    output,
    JSON.stringify({ date: '2026-11-15', reviewedFiveToolRounds: report }, null, 2) + '\n',
  )
  console.log(
    JSON.stringify(
      {
        cases: report.caseExecutions,
        matched: report.matched.map((r) => ({
          model: r.key,
          baseline: r.baseline,
          candidate: r.candidate,
          cases: r.cases,
          baselineStrict: r.baselineStrict,
          candidateStrict: r.candidateStrict,
        })),
        rounds: report.rounds.map((r) => ({
          round: r.number,
          followup: r.followup,
          scores: r.runs.map((m) => ({
            model: m.key,
            required: m.taskComplete,
            strict: m.strict,
            cases: m.cases,
          })),
        })),
        gate: {
          requests: report.providerGate.requests,
          peak: report.providerGate.observedMaximumPerRollingMinute,
          rateLimitResponses: report.providerGate.rateLimitResponses,
          httpErrorResponses: report.providerGate.httpErrorResponses,
        },
      },
      null,
      2,
    ),
  )
}
