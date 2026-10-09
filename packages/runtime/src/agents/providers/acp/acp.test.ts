/// <reference types="node" />
import * as warmProcesses from '../../execution/warm-processes.js'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRun } from '../../execution/types.js'
import { acpAdapter } from './acp.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(
  holdPrompt = false,
  lifecycle = false,
  compactCommand = false,
  permissionKinds: string[] = [],
  nativeChildren = false,
) {
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
const native = (state) => process.stdout.write(JSON.stringify({ jsonrpc:'2.0',method:'session/update',params:{sessionId:'session',update:{sessionUpdate:'subagent_update',sessionId:'native-child',title:'Native',state:{state},capabilities:{cancel:{}}}}})+'\\n')
const commands = () => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
  sessionId: 'session', update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Compact context' }] }
} }) + '\\n')
const configOptions = [
  { id: 'model', name: 'Model', type: 'select', category: 'model', currentValue: 'a', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] },
  { id: 'toggle', name: 'Toggle', type: 'boolean', currentValue: false }
]
let pendingPrompt
const permissionKinds = ${JSON.stringify(permissionKinds)}
let permissionIndex = 0
const requestPermission = () => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'permission-' + permissionIndex, method: 'session/request_permission', params: {
  sessionId: 'session', toolCall: { toolCallId: 'tool-' + permissionIndex, kind: permissionKinds[permissionIndex], title: 'Tool request' },
  options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }]
} }) + '\\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const input = JSON.parse(line)
  messages.push(input)
  writeFileSync(process.env.TEST_ACP_RECORD, JSON.stringify(messages))
  if (input.method === 'initialize') respond(input.id, { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: ${lifecycle ? '{ resume: {}, close: {}, delete: {} }' : '{}'} } })
  if (input.method === 'session/new') respond(input.id, { sessionId: 'session', modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }, { id: 'plan', name: 'Plan' }] }, configOptions })
  if (input.method === 'session/load') { update('old'); respond(input.id, { modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }, { id: 'plan', name: 'Plan' }] }, configOptions }) }
  if (input.method === 'session/resume') { if (${compactCommand}) commands(); respond(input.id, { modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }, { id: 'plan', name: 'Plan' }] }, configOptions }) }
  if (input.method === 'session/close') respond(input.id, {})
  if (input.method === 'session/delete') respond(input.id, {})
  if (input.method === 'session/set_mode') respond(input.id, {})
  if (input.method === 'session/set_config_option') respond(input.id, { configOptions })
  if (input.method === 'session/prompt') { if (${nativeChildren}) native('running'); update('new'); if (${holdPrompt} || permissionKinds.length) pendingPrompt = input.id; else respond(input.id, { stopReason: 'end_turn' }); if (permissionKinds.length) requestPermission() }
  if (input.id === 'permission-' + permissionIndex && input.method === undefined) { permissionIndex++; if (permissionIndex < permissionKinds.length) requestPermission(); else respond(pendingPrompt, { stopReason: 'end_turn' }) }
  if (input.method === 'session/prompt' && ${nativeChildren}) setTimeout(() => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:'native-approval',method:'session/request_permission',params:{sessionId:'native-child',toolCall:{toolCallId:'native-tool',kind:'execute',title:'Child command'},options:[{optionId:'allow',name:'Allow',kind:'allow_once'},{optionId:'reject',name:'Reject',kind:'reject_once'}]}})+'\\n'),30)
  if (input.method === 'session/cancel' && input.params.sessionId === 'native-child') native('idle')
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

it('uses an advertised ACP compact command and reports completion', async () => {
  const { cwd, record, launch } = await fixture(false, true, true)
  const events: string[] = []
  const input = run(cwd, launch, {
    sessionId: 'session',
    compact: true,
    prompt: '/compact',
    onEvent: (name) => events.push(name),
  })
  await acpAdapter.run(input.run)
  const messages = JSON.parse(await readFile(record, 'utf8')) as Array<{
    method: string
    params?: { prompt?: Array<{ text?: string }> }
  }>
  expect(messages.find((message) => message.method === 'session/prompt')?.params?.prompt).toEqual([
    { type: 'text', text: '/compact' },
  ])
  expect(events).toContain('dovo/compaction/completed')
})

it('uses the installed launch, session mode and typed config values', async () => {
  const { cwd, record, launch } = await fixture()
  const boundaries: number[] = []
  const input = run(cwd, launch, {
    onTextBoundary: () => boundaries.push(input.output.join('').length),
  })
  await acpAdapter.run(input.run)
  expect(input.output).toEqual(['new'])
  expect(boundaries).toEqual([3])
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
it('keeps the ACP connection and session for a follow-up turn', async () => {
  const { cwd, record, launch } = await fixture(false, true)
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  const first = run(cwd, launch, { taskId: 'warm-acp-task' })
  const second = run(cwd, launch, { taskId: 'warm-acp-task', sessionId: 'session' })
  try {
    await acpAdapter.run(first.run)
    await acpAdapter.run(second.run)
    const messages = JSON.parse(await readFile(record, 'utf8')) as Array<{ method: string }>
    expect(messages.filter((item) => item.method === 'initialize')).toHaveLength(1)
    expect(messages.filter((item) => item.method === 'session/new')).toHaveLength(1)
    expect(messages.filter((item) => item.method === 'session/prompt')).toHaveLength(2)
    expect(messages.some((item) => item.method === 'session/close')).toBe(false)
    expect(first.output).toEqual(['new'])
    expect(second.output).toEqual(['new'])
  } finally {
    await acpAdapter.dispose?.()
    pressure.mockRestore()
  }
})

it('selects the restrictive mode for a tools-none turn', async () => {
  const { cwd, launch } = await fixture()
  const input = run(cwd, launch, { tools: 'none' })
  await acpAdapter.run(input.run)
  expect(input.output).toEqual(['new'])
})
it('closes and deletes an ephemeral ACP utility session when supported', async () => {
  const { cwd, record, launch } = await fixture(false, true)
  await acpAdapter.run(run(cwd, launch, { ephemeral: true }).run)
  const messages = JSON.parse(await readFile(record, 'utf8')) as Array<{ method: string }>
  expect(messages.map((item) => item.method)).toContain('session/close')
  expect(messages.map((item) => item.method)).toContain('session/delete')
})

it('auto-accepts ACP edits while asking for commands in auto-accept edits mode', async () => {
  const { cwd, record, launch } = await fixture(false, false, false, ['edit', 'execute'])
  const approve = vi.fn<AgentRun['approve']>(async () => false)
  const input = run(cwd, launch, { approve })
  input.run.agent.permission = 'workspace-write'
  await acpAdapter.run(input.run)
  const messages = JSON.parse(await readFile(record, 'utf8')) as Array<{
    id?: string
    result?: { outcome?: { optionId?: string } }
  }>
  expect(messages.find((message) => message.id === 'permission-0')?.result?.outcome?.optionId).toBe(
    'allow',
  )
  expect(messages.find((message) => message.id === 'permission-1')?.result?.outcome?.optionId).toBe(
    'reject',
  )
  expect(approve).toHaveBeenCalledOnce()
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

it('keeps ACP child traffic and controls connected after the parent returns and under pressure', async () => {
  const f = await fixture(false, false, false, [], true)
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(true)
  const approve = vi.fn<NonNullable<AgentRun['nativeAgentInteractions']>['approve']>(
    async () => true,
  )
  const native = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
  let control: Parameters<NonNullable<AgentRun['onNativeSession']>>[0] | undefined
  const input = run(f.cwd, f.launch, {
    taskId: 'native-acp',
    onSubagentEvent: native,
    onNativeSession: (session) => {
      control = session
    },
    nativeAgentInteractions: { approve, ask: async () => null },
  })
  try {
    await acpAdapter.run(input.run)
    await vi.waitFor(() => expect(approve).toHaveBeenCalledOnce())
    expect(native).not.toHaveBeenCalledWith('dovo/session/closed', {}, 'session')
    await acpAdapter.run({ ...input.run, sessionId: 'session' })
    const frames = JSON.parse(await readFile(f.record, 'utf8')) as Array<{ method: string }>
    expect(frames.filter((frame) => frame.method === 'initialize')).toHaveLength(1)
    await control?.stop('native-child')
    await vi.waitFor(() =>
      expect(native).toHaveBeenCalledWith(
        'subagent_update',
        expect.objectContaining({
          update: expect.objectContaining({ sessionId: 'native-child', state: { state: 'idle' } }),
        }),
        'session',
      ),
    )
  } finally {
    await acpAdapter.dispose?.()
    pressure.mockRestore()
  }
})
