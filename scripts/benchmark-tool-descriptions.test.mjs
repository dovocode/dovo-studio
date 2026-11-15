import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  score,
  cases,
  captureOptions,
  providerGateEnvironment,
} from './benchmark-tool-descriptions.mjs'

await test('provider override preserves existing settings and only accepts a loopback gate', () => {
  const original = {
    plugins: ['example'],
    providers: {
      dovo: { package: 'existing', settings: { apiKey: 'test-key', extra: true } },
      other: { name: 'Other' },
    },
  }
  const value = providerGateEnvironment('dovo/model', 'http://127.0.0.1:1234/v1', {
    OPENCODE_CONFIG_CONTENT: JSON.stringify(original),
  })
  const changed = JSON.parse(value.OPENCODE_CONFIG_CONTENT)
  assert.deepEqual(changed, {
    ...original,
    providers: {
      ...original.providers,
      dovo: {
        ...original.providers.dovo,
        settings: { ...original.providers.dovo.settings, baseURL: 'http://127.0.0.1:1234/v1' },
      },
    },
  })
  for (const url of [
    'https://remote.test',
    'http://user:pass@127.0.0.1:1234',
    'http://127.0.0.1:1234/?secret=value',
  ])
    assert.throws(() => providerGateEnvironment('dovo/model', url))
})

await test('all-tools capture includes Bot tools and all Memory scopes without changing defaults', () => {
  const catalog = [{ name: 'ask_question' }, { name: 'bot_history' }, { name: 'propose_skill' }]
  assert.deepEqual(captureOptions([]).memoryScopes, ['system'])
  assert.equal(captureOptions([]).select(catalog), catalog)
  const instructions = ['--suite', 'instructions']
  assert.deepEqual(captureOptions(instructions).select(catalog), [catalog[0]])
  const all = captureOptions([...instructions, '--all-tools'])
  assert.deepEqual(all.memoryScopes, ['system', 'project', 'projectless', 'bot'])
  assert.equal(all.select(catalog), catalog)
})

await test('scores direct and Studio-wrapped actions with their arguments', () => {
  const test = {
    id: 'browser',
    tool: 'browser',
    action: 'navigate',
    fields: { url: 'https://example.test' },
  }
  for (const input of [
    { action: 'navigate', url: 'https://example.test' },
    { command: { action: 'navigate', url: 'https://example.test' } },
  ]) {
    const tool = input.command ? 'studio_browsers' : 'browser'
    assert.equal(score({ ...test, tool }, [{ tool, input, valid: true }]).correct, true)
  }
  for (const input of [{ action: 'snapshot' }, { action: 'navigate', url: 'https://wrong.test' }]) {
    assert.equal(score(test, [{ tool: 'browser', input, valid: true }]).correct, false)
  }
})
await test('does not count a wrong tool, invalid call, timeout or missing call as success', () => {
  const test = { id: 'device', tool: 'devices' }
  assert.equal(score(test, [{ tool: 'device', valid: true }]).correct, false)
  assert.equal(score(test, [{ tool: 'devices', valid: false }]).correct, false)
  assert.equal(score(test, [{ tool: 'devices', valid: true }], 'timeout').correct, false)
  assert.equal(score(test, []).correct, false)
})
await test('separates first choice from unnecessary follow-up calls', () => {
  const result = score({ id: 'device', tool: 'devices' }, [
    { tool: 'devices', valid: true },
    { tool: 'device', valid: true },
  ])
  assert.equal(result.correct, true)
  assert.equal(result.singleAction, false)
})
await test('checks restraint when no tool is needed', () => {
  const test = { id: 'none', tool: null }
  assert.equal(score(test, []).correct, true)
  assert.equal(score(test, [], 'timeout').correct, false)
  assert.equal(score(test, [{ tool: 'devices', valid: true }]).correct, false)
  assert.equal(new Set(cases.map((test) => test.id)).size, cases.length)
})

await test('checks exclusive selectors and private-input destinations', () => {
  const watch = cases.find((test) => test.id === 'pipeline')
  const input = { action: 'watch', url: watch.fields.url, runIds: ['123456'] }
  assert.equal(score(watch, [{ tool: 'pipeline_watch', input, valid: true }]).correct, false)
  delete input.runIds
  assert.equal(score(watch, [{ tool: 'pipeline_watch', input, valid: true }]).correct, true)
  const secret = cases.find((test) => test.id === 'private-input')
  const call = {
    tool: 'secure_input',
    valid: true,
    input: {
      action: 'request',
      destination: { kind: 'command', command: '/wrong-command' },
    },
  }
  assert.equal(score(secret, [call]).correct, false)
  call.input.destination.command = '/usr/bin/true'
  assert.equal(score(secret, [call]).correct, true)
})
