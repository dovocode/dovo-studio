/// <reference types="node" />
import { afterEach, expect, it } from 'vite-plus/test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acpModels } from './acp.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

it('discovers modes, config and commands without reapplying settings already selected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dovo-acp-catalog-'))
  dirs.push(dir)
  const script = join(dir, 'agent.cjs')
  await writeFile(
    script,
    `
const { createInterface } = require('node:readline')
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
const options = [
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'a', options: [{ value: 'a', name: 'A' }] },
  { id: 'toggle', name: 'Toggle', type: 'boolean', currentValue: false }
]
createInterface({ input: process.stdin }).on('line', (line) => {
  const input = JSON.parse(line)
  if (!['initialize', 'session/new'].includes(input.method)) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: input.id, error: { code: -32600, message: 'Redundant setting request' } }) + '\\n')
    return
  }
  if (input.method === 'initialize') respond(input.id, { protocolVersion: 1 })
  if (input.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
      sessionId: 's', update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'review', description: 'Review files', input: { hint: 'path' } }] }
    } }) + '\\n')
    respond(input.id, { sessionId: 's', modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }] }, configOptions: options })
  }
})`,
  )
  const catalog = await acpModels(
    {
      provider: 'acp',
      endpoint: '',
      model: 'a',
      acpMode: 'code',
      acpConfig: { toggle: 'false', model: 'a' },
    },
    {
      command: process.execPath,
      args: [script],
      env: {},
    },
  )
  expect(catalog.models).toEqual([{ id: 'a', name: 'A' }])
  expect(catalog.acp?.modes).toEqual([{ id: 'code', name: 'Code' }])
  expect(catalog.acp?.configOptions.find((item) => item.id === 'toggle')).toEqual({
    id: 'toggle',
    name: 'Toggle',
    category: undefined,
    currentValue: 'false',
    options: [
      { id: 'true', name: 'On' },
      { id: 'false', name: 'Off' },
    ],
  })
  expect(catalog.acp?.commands).toEqual([
    { name: 'review', description: 'Review files', inputHint: 'path' },
  ])
})

it('applies changed settings in order and skips settings made current by earlier replies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dovo-acp-catalog-'))
  dirs.push(dir)
  const script = join(dir, 'agent.cjs'),
    log = join(dir, 'requests.log')
  await writeFile(
    script,
    `
const { createInterface } = require('node:readline')
const { appendFileSync } = require('node:fs')
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
let options = [
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'a', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] },
  { id: 'thought', name: 'Thought', category: 'thought_level', type: 'select', currentValue: 'low', options: [{ value: 'low', name: 'Low' }] },
  { id: 'toggle', name: 'Toggle', type: 'boolean', currentValue: false }
]
createInterface({ input: process.stdin }).on('line', (line) => {
  const input = JSON.parse(line), params = input.params || {}
  appendFileSync(${JSON.stringify(log)}, input.method + (params.configId ? ':' + params.configId + '=' + params.value : '') + '\\n')
  if (input.method === 'initialize') respond(input.id, { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { close: {} } } })
  else if (input.method === 'session/new') respond(input.id, { sessionId: 's', modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }, { id: 'review', name: 'Review' }] }, configOptions: options })
  else if (input.method === 'session/set_mode') {
    options = options.map(option => option.id === 'thought' ? { ...option, options: [{ value: 'high', name: 'High' }], currentValue: 'high' } : option)
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'config_option_update', configOptions: options } } }) + '\\n')
    respond(input.id, {})
  } else if (input.method === 'session/set_config_option') {
    options = options.map(option => option.id === params.configId ? { ...option, currentValue: params.value } : option)
    respond(input.id, { configOptions: options })
  } else if (input.method === 'session/close') respond(input.id, {})
})`,
  )
  const catalog = await acpModels(
    {
      provider: 'acp',
      endpoint: '',
      model: 'b',
      acpMode: 'review',
      acpConfig: { model: 'b', thought: 'high', toggle: 'true' },
    },
    { command: process.execPath, args: [script], env: {} },
  )
  expect(catalog.reasoning).toEqual([{ id: 'high', name: 'High' }])
  expect(catalog.acp?.configOptions.map(({ id, currentValue }) => [id, currentValue])).toEqual([
    ['model', 'b'],
    ['thought', 'high'],
    ['toggle', 'true'],
  ])
  expect((await readFile(log, 'utf8')).trim().split('\n')).toEqual([
    'initialize',
    'session/new',
    'session/set_mode',
    'session/set_config_option:model=b',
    'session/set_config_option:toggle=true',
    'session/close',
  ])
})
