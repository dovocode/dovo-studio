import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { collectFinalRounds } from './summarize-final-tool-rounds.mjs'

const hash = (text) => createHash('sha256').update(text).digest('hex')
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-final-summary-'))
  const save = (file, value) => writeFileSync(join(directory, file), JSON.stringify(value))
  const source = readFileSync(new URL('./model-instruction-cases.mjs', import.meta.url), 'utf8')
  const catalog = Array.from({ length: 53 }, (_, index) => ({ name: 'fixture_' + index }))
  const profiles = { default: 'Fixture only' }
  const tests = [{ id: 'all', steps: catalog.map((tool) => ({ tool: tool.name })), responses: {} }]
  save('catalog.json', catalog)
  save('profiles.json', profiles)
  save('round26-cases.json', tests)
  const raw = {
    model: 'fixture/model',
    caseHash: hash(JSON.stringify(tests)),
    catalogHash: hash(JSON.stringify(catalog)),
    instructionHash: hash(JSON.stringify(profiles)),
    providerRequestGate: 'shared loopback proxy',
    requested: ['all'],
    complete: true,
    source: { 'model-instruction-cases.mjs': source },
    results: [
      {
        id: 'all',
        correct: true,
        calls: catalog.map((tool) => ({ tool: tool.name, input: {}, valid: true })),
        toolAttempts: [],
      },
    ],
  }
  save('round26-model.json', raw)
  const manifest = {
    gateVerified: true,
    completedAt: '2026-11-14T00:00:00Z',
    workers: [{ key: 'model', status: 'fulfilled' }],
    sources: { 'scripts/model-instruction-cases.mjs': { text: source, hash: hash(source) } },
    catalogHash: raw.catalogHash,
    instructionHash: raw.instructionHash,
    models: { model: raw.model },
    rounds: { 26: { caseHash: raw.caseHash, cases: 1 } },
    batches: [{ number: 26, key: 'model', file: 'round26-model.json' }],
    rateLimit: { maximumPerRollingMinute: 18 },
  }
  save('manifest.json', manifest)
  const requests = [{ startedAt: 1000, method: 'POST', path: '/chat/completions', status: 200 }]
  const ledger = () => {
    save('provider-requests.json', requests)
    writeFileSync(
      join(directory, 'provider-dispatch.jsonl'),
      requests
        .map((entry) =>
          JSON.stringify({ startedAt: entry.startedAt, method: entry.method, path: entry.path }),
        )
        .join('\n') + '\n',
    )
  }
  ledger()
  return {
    directory,
    raw,
    manifest,
    requests,
    save,
    ledger,
    close: () => rmSync(directory, { recursive: true, force: true }),
  }
}

await test('summary retains raw results and rejects changed scores or requested case lists', () => {
  const f = fixture()
  try {
    assert.equal(collectFinalRounds(f.directory).caseExecutions, 1)
    f.raw.results[0].correct = false
    f.save('round26-model.json', f.raw)
    assert.throws(() => collectFinalRounds(f.directory), /Score mismatch/)
    f.raw.results[0].correct = true
    f.raw.requested = ['unrequested']
    f.save('round26-model.json', f.raw)
    assert.throws(() => collectFinalRounds(f.directory), /Unexpected continuation/)
  } finally {
    f.close()
  }
})

await test('summary rejects missing completion and a rolling-minute budget breach', () => {
  const f = fixture()
  try {
    f.manifest.gateVerified = false
    f.save('manifest.json', f.manifest)
    assert.throws(() => collectFinalRounds(f.directory), /not complete/)
    f.manifest.gateVerified = true
    f.save('manifest.json', f.manifest)
    f.requests.push(
      ...Array.from({ length: 18 }, (_, index) => ({
        startedAt: 2000 + index * 1000,
        method: 'POST',
        path: '/chat/completions',
      })),
    )
    f.ledger()
    assert.throws(() => collectFinalRounds(f.directory), /budget exceeded/)
  } finally {
    f.close()
  }
})
