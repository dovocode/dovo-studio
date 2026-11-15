// Paid comparison. Actions remain fixtures; all workers share one request gate.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import {
  reviewedToolCases as qualityCases,
  reviewedToolRounds,
} from './reviewed-tool-instruction-rounds.mjs'
import { startProviderProxy } from './benchmark-provider-proxy.mjs'
const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Missing ' + name)
  return args[i + 1]
}
const directory = resolve(option('--directory')),
  phase = Number(option('--round')),
  executable = option('--executable')
if (!Object.hasOwn(reviewedToolRounds, phase)) throw Error('Invalid round')
const followup = args.includes('--followup')
if (followup && phase !== 41) throw Error('Follow-up requires completed round 41')
const root = join(directory, 'round' + phase + (followup ? '-followup' : '')),
  read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const hash = (text) => createHash('sha256').update(text).digest('hex')
if (existsSync(join(root, 'manifest.json'))) throw Error('Refuse to overwrite phase')
mkdirSync(root, { recursive: true })
const run = (args, log) =>
  new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    for (const s of [p.stdout, p.stderr]) s.on('data', (c) => appendFileSync(log, c))
    p.once('error', reject)
    p.once('exit', resolve)
  })
if (phase === 37)
  writeFileSync(join(directory, 'cases.json'), JSON.stringify(qualityCases, null, 2) + '\n')
const tests = read(join(directory, 'cases.json'))
if (JSON.stringify(tests) !== JSON.stringify(qualityCases))
  throw Error('Cases changed between phases')
if (phase !== 37) {
  const previous = 'round' + (followup ? phase : phase - 1)
  const old = read(join(directory, previous, 'manifest.json'))
  if (!old.completedAt || old.workers.some((x) => x.status !== 'fulfilled'))
    throw Error('Previous phase incomplete')
  const ledger = read(join(directory, previous, 'provider-requests.json'))
  const waitMs = Math.max(0, ledger.at(-1).startedAt + 60000 - Date.now())
  if (waitMs) await delay(waitMs)
}
if (
  (await run(
    [
      'scripts/benchmark-tool-descriptions.mjs',
      '--capture',
      join(root, 'catalog.json'),
      '--all-tools',
    ],
    join(root, 'capture.log'),
  )) !== 0
)
  throw Error('Capture failed')
const { modelToolInstructions } =
  await import('../packages/runtime/dist/agents/execution/model-tool-instructions.js')
const options = {
  readOnly: false,
  linkedProjectsEnabled: true,
  memoryScopes: ['project', 'system', 'projectless', 'bot'],
  artifactsEnabled: true,
  pipelineWatchingEnabled: true,
  pullRequestWatchingEnabled: true,
  pullRequestBabysittingEnabled: true,
  deviceHubEnabled: true,
  studioTools: { threads: true, automations: true, browsers: true, ui: true, diagnostics: true },
}
const profiles = {
  default: modelToolInstructions(options).join('\n\n'),
  'no-babysitting': modelToolInstructions({
    ...options,
    pullRequestBabysittingEnabled: false,
  }).join('\n\n'),
}
writeFileSync(join(root, 'profiles.json'), JSON.stringify(profiles, null, 2) + '\n')
const models = {
  deepseek: 'dovo/deepseek-v4.1-flash:dev:prio',
  qwen: 'dovo/qwen3.8-27b:dev:prio',
  glm: 'dovo/glm-5.3-flash:dev:prio',
}
const sourcePaths = [
  'scripts/run-reviewed-tool-rounds.mjs',
  'scripts/reviewed-tool-instruction-rounds.mjs',
  'scripts/tool-quality-round.mjs',
  'scripts/benchmark-tool-descriptions.mjs',
  'scripts/model-instruction-cases.mjs',
  'scripts/benchmark-provider-proxy.mjs',
  'packages/runtime/src/agent-tools/server.ts',
  'packages/runtime/src/agents/execution/model-tool-instructions.ts',
  'packages/runtime/src/studio/tool-definitions.ts',
  'packages/runtime/src/agent-tools/device-guidance.ts',
  'packages/runtime/dist/agent-tools/workflow-command.js',
  'packages/runtime/dist/agent-tools/terminal-input-command.js',
  'packages/runtime/dist/agent-tools/secure-input-command.js',
  'packages/runtime/dist/agent-tools/secure-input-result.js',
  'packages/runtime/dist/agent-tools/linked-project-command.js',
  'packages/runtime/dist/agent-tools/response-prepare-command.js',
  'packages/runtime/dist/studio/tool-definitions.js',
]
const extra = args.includes('--extra-cases') ? option('--extra-cases').split(',') : []
if (
  (phase < 39 && extra.length) ||
  (followup && !extra.length) ||
  new Set(extra).size !== extra.length ||
  extra.some((id) => !tests.some((test) => test.id === id))
)
  throw Error('Invalid extra cases')
const selected = tests
  .filter(
    (test) => (!followup && reviewedToolRounds[phase].includes(test.id)) || extra.includes(test.id),
  )
  .map((test) => test.id)
const manifest = {
  phase,
  followup,
  selectedCaseIds: selected,
  requestedExtraCaseIds: extra,
  startedAt: new Date().toISOString(),
  models,
  coreIds: reviewedToolRounds[37],
  caseHash: hash(JSON.stringify(tests)),
  catalogHash: hash(readFileSync(join(root, 'catalog.json'))),
  instructionHash: hash(JSON.stringify(profiles)),
  sources: Object.fromEntries(
    sourcePaths.map((path) => {
      const text = readFileSync(path, 'utf8')
      return [path, { hash: hash(text), text }]
    }),
  ),
  batches: [],
}
const save = () =>
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
save()
const config = read(join(homedir(), '.config/opencode/opencode.json'))
const proxy = await startProviderProxy({
  upstream: config.providers.dovo.settings.baseURL,
  onDispatch: (r) =>
    appendFileSync(join(root, 'provider-dispatch.jsonl'), JSON.stringify(r) + '\n'),
})
try {
  const outcomes = await Promise.allSettled(
    Object.entries(models).map(async ([key, model]) => {
      for (let offset = 0; offset < selected.length; offset += 8) {
        let remaining = selected.slice(offset, offset + 8),
          part = 1
        while (remaining.length) {
          const name = `${key}-${offset / 8 + 1}-${part++}`
          const file = join(root, name + '.json'),
            log = join(root, name + '.log')
          const code = await run(
            [
              'scripts/benchmark-tool-descriptions.mjs',
              '--run',
              '--suite',
              'instructions',
              '--case-definitions',
              join(directory, 'cases.json'),
              '--instructions',
              join(root, 'profiles.json'),
              '--catalog',
              join(root, 'catalog.json'),
              '--output',
              file,
              '--model',
              model,
              '--executable',
              executable,
              '--provider-base-url',
              proxy.baseURL,
              '--cases',
              remaining.join(','),
            ],
            log,
          )
          if (!existsSync(file)) throw Error('Missing report ' + name)
          const raw = read(file),
            capped =
              !raw.complete && readFileSync(log, 'utf8').includes('Reported usage cap reached')
          manifest.batches.push({ key, file: name + '.json', code, capped, requested: remaining })
          save()
          console.log(JSON.stringify({ phase, key, cases: raw.cases, strict: raw.correct, capped }))
          if ((code !== 0 && !capped) || !raw.cases) throw Error('Failed batch ' + name)
          const ids = raw.results.map((r) => r.id)
          if (new Set(ids).size !== ids.length || ids.some((id) => !remaining.includes(id)))
            throw Error('Duplicate or unknown case')
          remaining = remaining.filter((id) => !ids.includes(id))
        }
      }
    }),
  )
  manifest.workers = outcomes.map((o, i) => ({
    key: Object.keys(models)[i],
    status: o.status,
    ...(o.status === 'rejected' ? { error: String(o.reason) } : {}),
  }))
  manifest.completedAt = new Date().toISOString()
  save()
  if (outcomes.some((o) => o.status === 'rejected')) throw Error('Incomplete phase')
} finally {
  await proxy.close()
  writeFileSync(join(root, 'provider-requests.json'), JSON.stringify(proxy.records, null, 2) + '\n')
}
