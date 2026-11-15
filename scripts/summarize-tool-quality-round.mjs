import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreToolQuality } from './tool-quality-round.mjs'

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const hash = (value) => createHash('sha256').update(value).digest('hex')

export function requestEvidence(requests, dispatches) {
  if (
    requests.length !== dispatches.length ||
    requests.some((r, i) =>
      ['startedAt', 'method', 'path'].some((field) => r[field] !== dispatches[i][field]),
    )
  )
    throw Error('Provider ledger mismatch')
  let left = 0,
    peak = 0
  for (let right = 0; right < requests.length; right++) {
    if (right && requests[right].startedAt < requests[right - 1].startedAt)
      throw Error('Non-monotonic request ledger')
    while (requests[right].startedAt - requests[left].startedAt >= 60000) left++
    peak = Math.max(peak, right - left + 1)
  }
  if (peak > 18) throw Error('Provider request budget exceeded')
  return {
    requests: requests.length,
    observedMaximumPerRollingMinute: peak,
    rateLimitResponses: requests.filter((r) => r.status === 429).length,
    httpErrorResponses: requests.filter((r) => r.status >= 400).length,
    missingHttpStatuses: requests.filter((r) => typeof r.status !== 'number').length,
    connectionErrorFlags: requests.filter((r) => r.failed === true).length,
  }
}

export function compareQuality(baseline, candidate, ids) {
  const byId = (results) => new Map(results.map((r) => [r.id, r]))
  const before = byId(baseline),
    after = byId(candidate)
  if (before.size !== baseline.length || after.size !== candidate.length)
    throw Error('Repeated result')
  const pairs = ids.map((id) => {
    const a = before.get(id),
      b = after.get(id)
    if (!a || !b) throw Error('Missing matched case')
    return {
      id,
      baseline: a.taskComplete,
      candidate: b.taskComplete,
      baselineStrict: a.correct,
      candidateStrict: b.correct,
    }
  })
  return {
    cases: pairs.length,
    baseline: pairs.filter((p) => p.baseline).length,
    candidate: pairs.filter((p) => p.candidate).length,
    baselineStrict: pairs.filter((p) => p.baselineStrict).length,
    candidateStrict: pairs.filter((p) => p.candidateStrict).length,
    gains: pairs.filter((p) => !p.baseline && p.candidate).map((p) => p.id),
    regressions: pairs.filter((p) => p.baseline && !p.candidate).map((p) => p.id),
    pairs,
  }
}

export function collectToolQuality(directory) {
  const cases = read(join(directory, 'cases.json'))
  const sources = {},
    phases = {},
    ledgers = [],
    dispatches = []
  let baselineManifest
  const phaseNames = ['baseline', 'candidate']
  if (existsSync(join(directory, 'followup/manifest.json'))) phaseNames.push('followup')
  for (const phase of phaseNames) {
    const root = join(directory, phase),
      manifest = read(join(root, 'manifest.json'))
    if (
      !manifest.completedAt ||
      manifest.workers?.length !== 3 ||
      manifest.workers.some((w) => w.status !== 'fulfilled')
    )
      throw Error('Incomplete phase')
    if (manifest.phase !== phase || manifest.caseHash !== hash(JSON.stringify(cases)))
      throw Error('Frozen case mismatch')
    if (phase === 'baseline') baselineManifest = manifest
    else {
      for (const field of ['models', 'coreIds'])
        if (JSON.stringify(manifest[field]) !== JSON.stringify(baselineManifest[field]))
          throw Error('Comparison input mismatch')
      for (const path of [
        ...(phase === 'candidate' ? ['scripts/run-tool-quality-round.mjs'] : []),
        'scripts/tool-quality-round.mjs',
        'scripts/benchmark-tool-descriptions.mjs',
        'scripts/model-instruction-cases.mjs',
        'scripts/benchmark-provider-proxy.mjs',
      ])
        if (manifest.sources[path].hash !== baselineManifest.sources[path].hash)
          throw Error('Harness changed during comparison: ' + path)
    }
    for (const [path, source] of Object.entries(manifest.sources)) {
      if (hash(source.text) !== source.hash) throw Error('Frozen source mismatch')
      sources[source.hash] = { name: path, text: source.text }
    }
    for (const path of ['scripts/tool-quality-round.mjs', 'scripts/model-instruction-cases.mjs'])
      if (hash(readFileSync(path)) !== manifest.sources[path].hash) throw Error('Use frozen scorer')
    const catalog = read(join(root, 'catalog.json')),
      profiles = read(join(root, 'profiles.json'))
    if (
      hash(readFileSync(join(root, 'catalog.json'))) !== manifest.catalogHash ||
      hash(JSON.stringify(profiles)) !== manifest.instructionHash
    )
      throw Error('Catalog/profile mismatch')
    const expectedTools = new Set(cases.flatMap((t) => t.steps.map((s) => s.tool)))
    if (
      catalog.length !== 53 ||
      expectedTools.size !== 53 ||
      catalog.some((t) => !expectedTools.has(t.name))
    )
      throw Error('Incomplete tool coverage')
    const selected =
      phase === 'baseline'
        ? manifest.coreIds
        : phase === 'followup'
          ? manifest.selectedCaseIds
          : cases.map((t) => t.id)
    if (phase === 'followup') {
      const expected = cases
        .filter((t) =>
          [
            'bot-history-recall',
            'pending-private-input-is-not-completed',
            'native-discovery-install',
            'bot-skill-proposal',
          ].includes(t.id),
        )
        .map((t) => t.id)
      if (JSON.stringify(selected) !== JSON.stringify(expected))
        throw Error('Unexpected follow-up cases')
    }
    const runs = []
    for (const [key, model] of Object.entries(manifest.models)) {
      const results = [],
        batches = [],
        seen = new Set(),
        tools = new Set()
      for (const batch of manifest.batches.filter((b) => b.key === key)) {
        const raw = read(join(root, batch.file))
        if (
          raw.model !== model ||
          raw.caseHash !== manifest.caseHash ||
          raw.catalogHash !== manifest.catalogHash ||
          raw.instructionHash !== manifest.instructionHash ||
          raw.providerRequestGate !== 'shared loopback proxy' ||
          JSON.stringify(raw.requested) !== JSON.stringify(batch.requested)
        )
          throw Error('Batch input mismatch')
        if (!raw.complete && !batch.capped) throw Error('Unexplained incomplete batch')
        if (
          batch.capped &&
          !readFileSync(join(root, batch.file.replace(/\.json$/, '.log')), 'utf8').includes(
            'Reported usage cap reached',
          )
        )
          throw Error('Unconfirmed usage cap')
        if (
          raw.results.length !== raw.cases ||
          raw.correct !== raw.results.filter((r) => r.correct).length ||
          raw.complete !== (raw.cases === raw.requested.length)
        )
          throw Error('Batch totals mismatch')
        const expected = selected.filter((id) => !seen.has(id)).slice(0, 8 - (seen.size % 8))
        if (JSON.stringify(raw.requested) !== JSON.stringify(expected))
          throw Error('Unexpected continuation')
        for (const result of raw.results) {
          const test = cases.find((t) => t.id === result.id)
          if (!test || !raw.requested.includes(result.id) || seen.has(result.id))
            throw Error('Unknown/repeated case')
          seen.add(result.id)
          const scored = scoreToolQuality(
            test,
            result.calls,
            result.error,
            result.assistantText,
            result.nativeAttempts,
            result.toolAttempts,
            raw.workingDirectory,
          )
          if (scored.correct !== result.correct) throw Error('Historical score mismatch')
          const { calls: _calls, expected: _expected, id: _id, ...quality } = scored
          results.push({ ...result, quality, taskComplete: scored.taskComplete })
          result.calls.filter((c) => c.valid && !c.fixtureError).forEach((c) => tools.add(c.tool))
        }
        const sourceRefs = {}
        for (const [name, text] of Object.entries(raw.source)) {
          const entry = Object.entries(manifest.sources).find(([path]) => basename(path) === name)
          if (!entry || hash(text) !== entry[1].hash)
            throw Error('Source changed within phase: ' + name)
          sourceRefs[name] = entry[1].hash
        }
        const { source: _, results: _results, ...metadata } = raw
        batches.push({ ...batch, ...metadata, sourceRefs })
      }
      if (seen.size !== selected.length) throw Error('Missing cases')
      const transfer = results.filter((r) => !manifest.coreIds.includes(r.id))
      runs.push({
        key,
        model,
        cases: results.length,
        strict: results.filter((r) => r.correct).length,
        taskComplete: results.filter((r) => r.taskComplete).length,
        transfer: {
          cases: transfer.length,
          strict: transfer.filter((r) => r.correct).length,
          taskComplete: transfer.filter((r) => r.taskComplete).length,
        },
        validCallCoverage: [...tools].sort((a, b) => a.localeCompare(b)),
        missingValidCalls: catalog.filter((t) => !tools.has(t.name)).map((t) => t.name),
        failures: results
          .filter((r) => !r.taskComplete)
          .map((r) => ({
            id: r.id,
            error: r.error,
            rejectedArguments: r.quality.rejectedArguments,
            unexpectedCalls: r.quality.unexpectedCalls,
            requiredCompleted: r.quality.requiredCompleted,
            requiredTasks: r.quality.requiredTasks,
          })),
        reportedTokens: batches.some((b) => b.reportedTokens === null)
          ? null
          : batches.reduce((n, b) => n + b.reportedTokens, 0),
        casesWithoutUsage: batches.reduce((n, b) => n + b.cases - b.usageReports, 0),
        usageComplete: batches.every((b) => b.usageReports === b.cases),
        batches,
        results,
      })
    }
    const requests = read(join(root, 'provider-requests.json'))
    const dispatched = readFileSync(join(root, 'provider-dispatch.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse)
    if (!requests.length) throw Error('Missing provider request evidence')
    const evidence = requestEvidence(requests, dispatched)
    ledgers.push(...requests)
    dispatches.push(...dispatched)
    phases[phase] = {
      startedAt: manifest.startedAt,
      completedAt: manifest.completedAt,
      catalog,
      profiles,
      catalogHash: manifest.catalogHash,
      instructionHash: manifest.instructionHash,
      selectedCaseIds: selected,
      sourceRefs: Object.fromEntries(
        Object.entries(manifest.sources).map(([name, s]) => [name, s.hash]),
      ),
      providerGate: evidence,
      runs,
    }
  }
  const matched = phases.baseline.runs.map((run) => ({
    key: run.key,
    ...compareQuality(
      run.results,
      phases.candidate.runs.find((r) => r.key === run.key).results,
      baselineManifest.coreIds,
    ),
  }))
  const summarySource = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  sources[hash(summarySource)] = {
    name: 'scripts/summarize-tool-quality-round.mjs',
    text: summarySource,
  }
  return {
    method:
      'Round 36. Matched 12-case baseline/candidate comparison on three OpenCode models, variant low. Candidate adds 29 transfer cases covering all 53 tools. Inputs frozen before baseline. Task scoring allows at most two explicit verification reads; original strict scores remain. All tool effects use fixtures, native tools denied. No failed case retries within a phase.' +
      (phases.followup
        ? ' A separate twelve-case changed-instruction follow-up retains all prior failures.'
        : '') +
      ' A small synthetic comparison cannot establish general reliability or production effects.',
    caseExecutions: Object.values(phases)
      .flatMap((p) => p.runs)
      .reduce((n, r) => n + r.cases, 0),
    cases,
    coreIds: baselineManifest.coreIds,
    models: baselineManifest.models,
    sources,
    phases,
    matched,
    providerGate: {
      intervalMs: 3500,
      maximumPerRollingMinute: 18,
      providerLimit: 20,
      scope: 'These benchmark workers only; other clients are outside the gate.',
      connectionErrorFlagMeaning:
        'Proxy flags include client cancellation of SSE streams and lack error codes. They do not establish failed model calls.',
      ...requestEvidence(ledgers, dispatches),
      ledger: ledgers,
    },
    limits: {
      caseMs: 120000,
      batchMs: 1200000,
      reportedTokenSoftCap: 500000,
      missingUsage: 'unknown',
    },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error('Supply a completed comparison directory')
  const summary = collectToolQuality(resolve(process.argv[2]))
  const path = process.argv[3] ?? 'scripts/benchmarks/model-instructions/2026-11-14.json'
  const report = existsSync(path) ? read(path) : {}
  if (report.round36ToolQuality) throw Error('Refuse to replace saved evidence')
  report.round36ToolQuality = summary
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n')
  const { ledger: _, ...providerGate } = summary.providerGate
  console.log(
    JSON.stringify(
      {
        matched: summary.matched.map((row) => {
          const { pairs: _, ...result } = row
          return result
        }),
        transfer: summary.phases.candidate.runs.map((r) => ({ key: r.key, ...r.transfer })),
        providerGate,
      },
      null,
      2,
    ),
  )
}
