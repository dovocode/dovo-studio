import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreInstructions } from './model-instruction-cases.mjs'

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const hash = (value) => createHash('sha256').update(value).digest('hex')
export function collectFinalRounds(directory) {
  const manifest = read(join(directory, 'manifest.json'))
  if (
    !manifest.gateVerified ||
    !manifest.completedAt ||
    manifest.workers?.some((worker) => worker.status !== 'fulfilled')
  )
    throw new Error('Evaluation is not complete')
  for (const source of Object.values(manifest.sources))
    if (hash(source.text) !== source.hash) throw new Error('Frozen source hash mismatch')
  if (
    hash(readFileSync(new URL('./model-instruction-cases.mjs', import.meta.url))) !==
    manifest.sources['scripts/model-instruction-cases.mjs'].hash
  )
    throw new Error('Use the frozen scorer version')
  const catalog = read(join(directory, 'catalog.json'))
  const profiles = read(join(directory, 'profiles.json'))
  if (
    hash(readFileSync(join(directory, 'catalog.json'))) !== manifest.catalogHash ||
    hash(JSON.stringify(profiles)) !== manifest.instructionHash
  )
    throw new Error('Catalog or profile mismatch')
  const sources = Object.fromEntries(
    Object.entries(manifest.sources).map(([name, source]) => [
      source.hash,
      { name, text: source.text },
    ]),
  )
  const coverage = Object.fromEntries(Object.keys(manifest.models).map((key) => [key, new Set()]))
  const rounds = []
  const cases = {}
  for (const [number, definition] of Object.entries(manifest.rounds)) {
    const tests = read(join(directory, `round${number}-cases.json`))
    if (hash(JSON.stringify(tests)) !== definition.caseHash || tests.length !== definition.cases)
      throw new Error('Case hash mismatch')
    cases[number] = tests
    const runs = []
    for (const [key, model] of Object.entries(manifest.models)) {
      const seen = new Set(),
        results = [],
        batches = []
      for (const batch of manifest.batches.filter(
        (batch) => String(batch.number) === number && batch.key === key,
      )) {
        const raw = read(join(directory, batch.file))
        if (
          raw.model !== model ||
          raw.caseHash !== definition.caseHash ||
          raw.catalogHash !== manifest.catalogHash ||
          raw.instructionHash !== manifest.instructionHash ||
          raw.providerRequestGate !== 'shared loopback proxy'
        )
          throw new Error('Batch input mismatch: ' + batch.file)
        const remaining = tests.filter((test) => !seen.has(test.id)).map((test) => test.id)
        const expected = batch.file.includes('-gate-probe') ? remaining.slice(0, 1) : remaining
        if (JSON.stringify(raw.requested) !== JSON.stringify(expected))
          throw new Error('Unexpected continuation: ' + batch.file)
        if (
          batch.capped &&
          !readFileSync(join(directory, batch.file.replace(/\.json$/, '.log')), 'utf8').includes(
            'Reported usage cap reached',
          )
        )
          throw new Error('Unconfirmed cap')
        if (!raw.complete && !batch.capped) throw new Error('Unexplained incomplete batch')
        for (const result of raw.results) {
          const test = tests.find((test) => test.id === result.id)
          if (!test || seen.has(result.id)) throw new Error('Unknown or repeated case')
          const rescored = scoreInstructions(
            test,
            result.calls,
            result.error,
            result.assistantText,
            result.nativeAttempts,
            result.toolAttempts,
          )
          if (rescored.correct !== result.correct) throw new Error('Score mismatch: ' + result.id)
          seen.add(result.id)
          results.push(result)
          for (const call of result.calls.filter((call) => call.valid)) coverage[key].add(call.tool)
        }
        const sourceRefs = {}
        for (const [name, text] of Object.entries(raw.source)) {
          const id = hash(text)
          const expected = Object.entries(manifest.sources).find(
            ([path]) => basename(path) === name,
          )
          if (!expected || expected[1].hash !== id)
            throw new Error('Source changed during evaluation: ' + name)
          sources[id] = { name, text }
          sourceRefs[name] = id
        }
        const { source: _, ...saved } = raw
        batches.push({ ...batch, ...saved, sourceRefs })
      }
      if (seen.size !== tests.length)
        throw new Error('Missing cases in round ' + number + ' for ' + key)
      runs.push({
        key,
        model,
        cases: results.length,
        correct: results.filter((result) => result.correct).length,
        totalCalls: results.reduce((sum, result) => sum + result.calls.length, 0),
        failures: results
          .filter((result) => !result.correct)
          .map((result) => ({
            id: result.id,
            ...(result.error ? { error: result.error } : {}),
            rejectedArguments: result.rejectedArguments,
          })),
        batches,
      })
    }
    rounds.push({ number: Number(number), runs })
  }
  const requests = read(join(directory, 'provider-requests.json'))
  const dispatches = readFileSync(join(directory, 'provider-dispatch.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse)
  if (
    requests.length !== dispatches.length ||
    requests.some((request, index) => request.startedAt !== dispatches[index].startedAt)
  )
    throw new Error('Provider request ledger mismatch')
  let left = 0,
    maximum = 0
  for (let right = 0; right < requests.length; right++) {
    if (right && requests[right].startedAt < requests[right - 1].startedAt)
      throw new Error('Wall clock changed; cannot verify rolling rate')
    while (requests[right].startedAt - requests[left].startedAt >= 60000) left++
    maximum = Math.max(maximum, right - left + 1)
  }
  if (maximum > 18) throw new Error('Provider request budget exceeded')
  const expectedToolCoverage = [
    ...new Set(
      Object.values(cases).flatMap((tests) =>
        tests.flatMap((test) => test.steps.map((step) => step.tool)),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b))
  if (catalog.length !== 53 || catalog.some((tool) => !expectedToolCoverage.includes(tool.name)))
    throw new Error('Incomplete tool cases')
  return {
    method:
      'Ten frozen final rounds on real OpenCode CLI 2.3.0, variant low. Full 53-tool catalog throughout. All MCP effects use fixtures; native tools denied. Same catalog and profiles for every model and round. Different rounds exercise different cases; no controlled global improvement or latency claim. Each tool has an explicit case across the matrix, not every action in every round. One initial DeepSeek case verifies proxy routing before the other workers start. Only unrun cases continue after reported-token caps. Failed cases are never retried away.',
    requested: 10,
    completed: rounds.length,
    caseExecutions: rounds.flatMap((round) => round.runs).reduce((sum, run) => sum + run.cases, 0),
    frozenAt: manifest.frozenAt,
    completedAt: manifest.completedAt,
    models: manifest.models,
    profiles,
    catalog,
    cases,
    sources,
    rounds,
    instructionHash: manifest.instructionHash,
    catalogHash: manifest.catalogHash,
    expectedToolCoverage,
    validCallCoverage: Object.fromEntries(
      Object.entries(coverage).map(([key, tools]) => [
        key,
        [...tools].sort((a, b) => a.localeCompare(b)),
      ]),
    ),
    missingValidCalls: Object.fromEntries(
      Object.entries(coverage).map(([key, tools]) => [
        key,
        catalog.filter((tool) => !tools.has(tool.name)).map((tool) => tool.name),
      ]),
    ),
    coverageLimits:
      'Schema-valid calls can occur in failed cases. They do not prove successful tasks or real effects. Strict scores penalize extra calls, argument rejections, native attempts and literal differences. Reported usage can be incomplete.',
    providerGate: {
      ...manifest.rateLimit,
      observedMaximumPerRollingMinute: maximum,
      requests: requests.length,
      rateLimitResponses: requests.filter((request) => request.status === 429).length,
      ledger: requests,
    },
    limits: {
      caseMs: 120000,
      batchMs: 1200000,
      reportedTokenSoftCap: 500000,
      missingUsage: 'unknown',
    },
  }
}

function main() {
  const directory = resolve(process.argv[2])
  const summary = collectFinalRounds(directory)
  if (summary.completed !== 10 || Object.keys(summary.models).length !== 3)
    throw new Error('Expected ten rounds on three models')
  const reportPath = 'scripts/benchmarks/model-instructions/2026-11-14.json'
  const report = read(reportPath)
  report.finalTenToolRounds = summary
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  const rows = summary.rounds
    .map(
      (round) =>
        `| ${round.number} | ${round.runs.map((run) => `${run.correct}/${run.cases}`).join(' | ')} |`,
    )
    .join('\n')
  const text = `## Final rounds 26 through 35

Ran ten final rounds on DeepSeek, Qwen and GLM with all 53 tools in each catalog. The cases include every tool across the matrix. They retain the corrected response fields, source evidence, computer targets, exact content and refusal wording from earlier rounds. There were ${summary.caseExecutions} case executions. The catalog and instruction profiles stay fixed throughout these rounds. Different rounds use different cases, so the table is not a controlled overall improvement comparison.

| Round | DeepSeek | Qwen | GLM |
| --- | --- | --- | --- |
${rows}

The benchmark now uses one shared loopback proxy for actual outbound provider requests. It spaces starts by 3.5 seconds across all three workers, including tool continuations and provider retries. The measured peak was ${summary.providerGate.observedMaximumPerRollingMinute} requests in a rolling minute, across ${summary.providerGate.requests} requests. The proxy observed ${summary.providerGate.rateLimitResponses} HTTP 429 responses. This gate covers these benchmark workers. Other clients remain outside it. Existing credentials and user configuration stay in place. The ledger stores request times, methods, paths and statuses. It excludes headers and bodies.

Workflow metadata now has visible root fields and accepts an array or its JSON encoding for phases. The original command schema validates the result before HTTP delivery. Invalid JSON, missing fields and fields from another action fail before dispatch. Human review and runtime permissions still apply. History guidance now tells agents to answer from sufficient snippets and keeps user-message IDs out of assistant response lookup. Terminal guidance specifies an actual CR, not literal backslash text. Argument errors must not be blamed on transport without evidence.

See \`finalTenToolRounds\` in the [saved report](../scripts/benchmarks/model-instructions/2026-11-14.json) for raw failures, frozen sources, hashes, request timing and valid-call coverage. A valid call does not prove a successful task or a real effect. All model-side MCP effects remain fixtures. Separate stdio MCP and HTTP tests cover metadata validation. The two-minute case limit, twenty-minute batch limit and 500,000 reported-token soft cap stay unchanged. Unknown usage remains unknown.
`
  const path = 'docs/model-instruction-benchmark.md',
    heading = '## Final rounds 26 through 35'
  const original = readFileSync(path, 'utf8'),
    index = original.indexOf(heading)
  writeFileSync(path, (index < 0 ? original.trimEnd() + '\n\n' : original.slice(0, index)) + text)
  console.log(
    JSON.stringify(
      {
        executions: summary.caseExecutions,
        providerGate: {
          requests: summary.providerGate.requests,
          peak: summary.providerGate.observedMaximumPerRollingMinute,
          rateLimitResponses: summary.providerGate.rateLimitResponses,
        },
        scores: summary.rounds.map((round) => ({
          round: round.number,
          scores: round.runs.map((run) => [run.correct, run.cases]),
        })),
      },
      null,
      2,
    ),
  )
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
