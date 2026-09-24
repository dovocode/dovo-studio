/// <reference types="node" />
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRun } from '../types.js'
import { acpAdapter } from './acp.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(holdPrompt = false, lifecycle = false) {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-acp-run-'))
  dirs.push(cwd)
  const script = join(cwd, 'agent.cjs')
  const record = join(cwd, 'messages.json')
  await writeFile(
    script,
    `
const { createInterface } = require('node:readline')
const { writeFileSync } = require('node:fs')
const messages = []
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
const update = (text) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
  sessionId: 'session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }
} }) + '\\n')
const configOptions = [
  { id: 'model', name: 'Model', type: 'select', category: 'model', currentValue: 'a', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] },
  { id: 'toggle', name: 'Toggle', type: 'boolean', currentValue: false }
]
let pendingPrompt
createInterface({ input: process.stdin }).on('line', (line) => {
  const input = JSON.parse(line)
  messages.push(input)
  writeFileSync(process.env.TEST_ACP_RECORD, JSON.stringify(messages))
  if (input.method === 'initialize') respond(input.id, { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: ${lifecycle ? '{ resume: {}, close: {} }' : '{}'} } })
  if (input.method === 'session/new') respond(input.id, { sessionId: 'session', modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }, { id: 'plan', name: 'Plan' }] }, configOptions })
  if (input.method === 'session/load') { update('old'); respond(input.id, { modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }, { id: 'plan', name: 'Plan' }] }, configOptions }) }
  if (input.method === 'session/resume') respond(input.id, { modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }, { id: 'plan', name: 'Plan' }] }, configOptions })
  if (input.method === 'session/close') respond(input.id, {})
  if (input.method === 'session/set_mode') respond(input.id, {})
  if (input.method === 'session/set_config_option') respond(input.id, { configOptions })
  if (input.method === 'session/prompt') { update('new'); if (${holdPrompt}) pendingPrompt = input.id; else respond(input.id, { stopReason: 'end_turn' }) }
  if (input.method === 'session/cancel' && pendingPrompt !== undefined) respond(pendingPrompt, { stopReason: 'cancelled' })
})`,
  )
  return {
    cwd,
    record,
    launch: { command: process.execPath, args: [script], env: { TEST_ACP_RECORD: record } },
  }
}

function run(cwd: string, launch: AgentRun['acpLaunch'], overrides: Partial<AgentRun> = {}) {
  const output: string[] = []
  const sessions: string[] = []
  const run: AgentRun = {
    agent: {
      id: 'agent',
      name: 'Agent',
      provider: 'acp',
      model: 'b',
      instructions: '',
      permission: 'ask',
      endpoint: '',
      acpMode: 'plan',
      acpConfig: { toggle: 'true' },
    },
    acpLaunch: launch,
    cwd,
    prompt: 'hello',
    signal: new AbortController().signal,
    onSession: (id) => sessions.push(id),
    onText: (text) => output.push(text),
    onActivity: () => {},
    approve: async () => true,
    ask: async () => null,
    ...overrides,
  }
  return { run, output, sessions }
}

it('uses the installed launch, session mode and typed config values', async () => {
  const { cwd, record, launch } = await fixture()
  const input = run(cwd, launch)
  await acpAdapter.run(input.run)
  expect(input.output).toEqual(['new'])
  expect(input.sessions).toEqual(['session'])
  const messages = JSON.parse(await readFile(record, 'utf8'))
  expect(
    messages.find((item: { method: string }) => item.method === 'session/set_mode').params.modeId,
  ).toBe('plan')
  expect(
    messages
      .filter((item: { method: string }) => item.method === 'session/set_config_option')
      .map((item: { params: unknown }) => item.params),
  ).toEqual([
    { sessionId: 'session', configId: 'model', value: 'b' },
    { sessionId: 'session', configId: 'toggle', type: 'boolean', value: true },
  ])
  expect(
    messages.find((item: { method: string }) => item.method === 'initialize').params
      .clientCapabilities.terminal,
  ).toBe(true)
})

it('does not append replayed messages while loading a session', async () => {
  const { cwd, launch } = await fixture()
  const input = run(cwd, launch, { sessionId: 'session' })
  await acpAdapter.run(input.run)
  expect(input.output).toEqual(['new'])
})

it('prefers replay-free resume and closes the active session when supported', async () => {
  const { cwd, record, launch } = await fixture(false, true)
  const input = run(cwd, launch, { sessionId: 'session' })
  await acpAdapter.run(input.run)
  const messages = JSON.parse(await readFile(record, 'utf8'))
  expect(messages.some((item: { method: string }) => item.method === 'session/resume')).toBe(true)
  expect(messages.some((item: { method: string }) => item.method === 'session/load')).toBe(false)
  expect(messages.some((item: { method: string }) => item.method === 'session/close')).toBe(true)
})

it('selects the restrictive mode for a tools-none turn', async () => {
  const { cwd, launch } = await fixture()
  const input = run(cwd, launch, { tools: 'none' })
  await acpAdapter.run(input.run)
  expect(input.output).toEqual(['new'])
})

it('sends session/cancel and accepts the cancelled stop reason', async () => {
  const { cwd, record, launch } = await fixture(true)
  const controller = new AbortController()
  const input = run(cwd, launch, { signal: controller.signal })
  const running = acpAdapter.run(input.run)
  for (let tries = 0; tries < 100; tries++) {
    const messages = await readFile(record, 'utf8')
      .then((value) => JSON.parse(value))
      .catch(() => [])
    if (messages.some((item: { method: string }) => item.method === 'session/prompt')) break
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  controller.abort()
  await running
  const messages = JSON.parse(await readFile(record, 'utf8'))
  expect(messages.some((item: { method: string }) => item.method === 'session/cancel')).toBe(true)
})
