// Opt-in paid evaluation. All model-side MCP effects remain fixtures.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finalToolRounds } from './final-tool-instruction-cases.mjs'
import { startProviderProxy } from './benchmark-provider-proxy.mjs'

const models = {
  deepseek: 'dovo/deepseek-v4.1-flash:dev:prio',
  qwen: 'dovo/qwen3.8-27b:dev:prio',
  glm: 'dovo/glm-5.3-flash:dev:prio',
}
const hash = (value) => createHash('sha256').update(value).digest('hex')
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
function run(args, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => appendFileSync(log, chunk))
    child.once('error', reject)
    child.once('exit', (code) => resolve(code))
  })
}

async function main() {
  const args = process.argv.slice(2)
  const option = (name) => {
    const value = args[args.indexOf(name) + 1]
    if (!args.includes(name) || !value || value.startsWith('--')) throw new Error('Missing ' + name)
    return value
  }
  const directory = resolve(option('--directory'))
  const executable = option('--executable')
  if (existsSync(join(directory, 'manifest.json')))
    throw new Error('Refusing to overwrite a frozen evaluation')
  mkdirSync(directory, { recursive: true })
  const catalogPath = join(directory, 'catalog.json')
  const captureCode = await run(
    ['scripts/benchmark-tool-descriptions.mjs', '--capture', catalogPath, '--all-tools'],
    join(directory, 'capture.log'),
  )
  if (captureCode !== 0) throw new Error('Catalog capture failed')
  const catalog = json(catalogPath)
  const expected = new Set(
    Object.values(finalToolRounds).flatMap((cases) =>
      cases.flatMap((test) => test.steps.map((step) => step.tool)),
    ),
  )
  if (catalog.length !== 53 || catalog.some((tool) => !expected.has(tool.name)))
    throw new Error('Incomplete tool coverage')
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
  const profilePath = join(directory, 'profiles.json')
  writeFileSync(profilePath, JSON.stringify(profiles, null, 2) + '\n')
  const sources = Object.fromEntries(
    [
      'scripts/benchmark-tool-descriptions.mjs',
      'scripts/model-instruction-cases.mjs',
      'scripts/all-tool-instruction-cases.mjs',
      'scripts/all-tool-instruction-followups.mjs',
      'scripts/final-tool-instruction-cases.mjs',
      'scripts/run-final-tool-rounds.mjs',
      'scripts/benchmark-provider-proxy.mjs',
      'packages/runtime/dist/agent-tools/workflow-command.js',
      'packages/runtime/dist/agent-tools/terminal-input-command.js',
      'packages/runtime/dist/agent-tools/secure-input-command.js',
      'packages/runtime/dist/agent-tools/secure-input-result.js',
      'packages/runtime/dist/agent-tools/linked-project-command.js',
      'packages/runtime/dist/agent-tools/response-prepare-command.js',
      'packages/runtime/dist/studio/tool-definitions.js',
      'packages/runtime/dist/agents/execution/model-tool-instructions.js',
    ].map((name) => {
      const text = readFileSync(name, 'utf8')
      return [name, { text, hash: hash(text) }]
    }),
  )
  const manifest = {
    frozenAt: new Date().toISOString(),
    models,
    catalogHash: hash(readFileSync(catalogPath)),
    instructionHash: hash(JSON.stringify(profiles)),
    sources,
    rounds: Object.fromEntries(
      Object.entries(finalToolRounds).map(([number, cases]) => {
        writeFileSync(
          join(directory, `round${number}-cases.json`),
          JSON.stringify(cases, null, 2) + '\n',
        )
        return [number, { caseHash: hash(JSON.stringify(cases)), cases: cases.length }]
      }),
    ),
    rateLimit: {
      intervalMs: 3500,
      maximumPerRollingMinute: 18,
      providerLimit: 20,
      scope: 'All requests from these workers; other clients are outside this gate.',
    },
    batches: [],
  }
  const save = () =>
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  save()
  const providerConfig = json(join(homedir(), '.config/opencode/opencode.json'))
  const upstream = providerConfig.providers?.dovo?.settings?.baseURL
  if (typeof upstream !== 'string') throw new Error('No configured Dovo provider base URL')
  const proxy = await startProviderProxy({
    upstream,
    onDispatch: (record) => {
      appendFileSync(join(directory, 'provider-dispatch.jsonl'), JSON.stringify(record) + '\n')
    },
  })
  async function batch(number, key, ids, suffix, reason) {
    const name = `round${number}-${key}${suffix}`
    const output = join(directory, name + '.json'),
      log = join(directory, name + '.log')
    if (existsSync(output) || existsSync(log)) throw new Error('Refusing to overwrite ' + name)
    const code = await run(
      [
        'scripts/benchmark-tool-descriptions.mjs',
        '--run',
        '--suite',
        'instructions',
        '--case-definitions',
        join(directory, `round${number}-cases.json`),
        '--instructions',
        profilePath,
        '--catalog',
        catalogPath,
        '--output',
        output,
        '--model',
        models[key],
        '--executable',
        executable,
        '--provider-base-url',
        proxy.baseURL,
        '--cases',
        ids.join(','),
      ],
      log,
    )
    if (!existsSync(output)) throw new Error('Missing batch report ' + name)
    const result = json(output)
    const capped =
      !result.complete && readFileSync(log, 'utf8').includes('Reported usage cap reached')
    manifest.batches.push({ number, key, file: name + '.json', reason, code, capped })
    save()
    console.log(
      JSON.stringify({ number, key, cases: result.cases, correct: result.correct, capped }),
    )
    if (code !== 0 && !capped) throw new Error('Batch failed: ' + name)
    if (!result.cases) throw new Error('Batch made no progress: ' + name)
    return result.results.map((test) => test.id)
  }
  try {
    // Verify that OpenCode uses the override before starting the other workers.
    const first = finalToolRounds[26][0].id
    await batch(26, 'deepseek', [first], '-gate-probe', 'Verify real provider routing')
    if (!proxy.records.length)
      throw new Error('No requests crossed the provider gate. Stop evaluation.')
    manifest.gateVerified = true
    save()
    const outcomes = await Promise.allSettled(
      Object.keys(models).map(async (key) => {
        for (const [round, cases] of Object.entries(finalToolRounds)) {
          let remaining = cases
            .map((test) => test.id)
            .filter((id) => !(key === 'deepseek' && round === '26' && id === first))
          let part = 1
          while (remaining.length) {
            const done = await batch(
              Number(round),
              key,
              remaining,
              part === 1 ? '' : `-part${part}`,
              part === 1 ? 'Main cases' : 'Unrun cases after reported-token cap',
            )
            if (done.some((id) => !remaining.includes(id)) || new Set(done).size !== done.length)
              throw new Error('Unexpected or duplicate result IDs')
            remaining = remaining.filter((id) => !done.includes(id))
            part++
          }
        }
      }),
    )
    manifest.workers = outcomes.map((outcome, index) => ({
      key: Object.keys(models)[index],
      status: outcome.status,
      ...(outcome.status === 'rejected' ? { error: String(outcome.reason) } : {}),
    }))
    manifest.completedAt = new Date().toISOString()
    save()
    if (outcomes.some((outcome) => outcome.status === 'rejected'))
      throw new Error('At least one model worker failed; preserve reports and inspect manifest')
  } finally {
    await proxy.close()
    writeFileSync(
      join(directory, 'provider-requests.json'),
      JSON.stringify(proxy.records, null, 2) + '\n',
    )
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
