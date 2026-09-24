/// <reference types="node" />
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acpModels } from './acp.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

it('discovers modes, select and boolean config, and session commands', async () => {
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
    { provider: 'acp', endpoint: '', model: '' },
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
