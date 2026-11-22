/// <reference types="node" />
import * as warmProcesses from '../../execution/warm-processes.js'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRun } from '../../execution/types.js'
import { acpAdapter, createAcpAdapter } from './acp.js'
import { decode, resourceSettingsSchema } from '@dovo/protocol'
import Database from 'better-sqlite3'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(
  holdPrompt = false,
  lifecycle = false,
  compactCommand = false,
  permissionKinds: string[] = [],
  nativeChildren: boolean | 'replay' = false,
  mcpCapabilities: { acp?: boolean; http?: boolean } = {},
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
const modes = { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }, { id: 'plan', name: 'Plan' }] };
const configMode = !!process.env.TEST_ACP_CONFIG_MODE;
if (configMode) configOptions.push({ id: 'agent_mode', name: 'Mode', type: 'select', category: 'mode', currentValue: 'code', options: modes.availableModes.map(({id, name}) => ({value:id, name})) });
if (process.env.TEST_ACP_THINKING) configOptions.push({ id: 'effort', name: 'Effort', type: 'select', category: 'thought_level', currentValue: 'low', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] });
if (process.env.TEST_ACP_KIRO) configOptions.push({ id: 'autopilot', name: 'Autopilot', type: 'select', currentValue: 'on', options: ['on', 'off'].map(value => ({ value, name: value })) });
const session = { configOptions, ...(!configMode && { modes }) };
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
  if (input.method === 'initialize') respond(input.id, { protocolVersion: 1, agentCapabilities: { mcpCapabilities: ${JSON.stringify(mcpCapabilities)}, loadSession: true, sessionCapabilities: ${lifecycle ? '{ resume: {}, close: {}, delete: {} }' : '{}'} } })
  if (input.method === 'session/new') respond(input.id, { sessionId: 'session', ...session })
  if (input.method === 'session/load') { if (${nativeChildren === 'replay'}) native('running'); update('old'); respond(input.id, session) }
  if (input.method === 'session/resume') { if (${nativeChildren === 'replay'}) native('running'); if (${compactCommand}) commands(); respond(input.id, session) }
  if (input.method === 'session/close') respond(input.id, {})
  if (input.method === 'session/delete') respond(input.id, {})
  if (input.method === 'session/set_mode') {
    if (process.env.TEST_ACP_MODE_EFFORT) {
      configOptions.push({ id: 'effort', name: 'Effort', type: 'select', category: 'thought_level', currentValue: 'low', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] })
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'session', update: { sessionUpdate: 'config_option_update', configOptions } } }) + '\\n')
    }
    respond(input.id, {})
  }
  if (input.method === 'session/set_config_option') {
    const option = configOptions.find(option => option.id === input.params.configId)
    if (option && !(option.id === 'model' && process.env.TEST_IGNORE_ACP_MODEL) && !(option.id === 'agent_mode' && process.env.TEST_IGNORE_ACP_MODE) && !(option.id === 'toggle' && process.env.TEST_IGNORE_ACP_TOGGLE)) option.currentValue = input.params.value
    if (option?.id === 'model' && process.env.TEST_ACP_THINKING) configOptions.find(({ id }) => id === 'effort').currentValue = 'low';
    if (option?.id === 'model' && process.env.TEST_MODEL_CATALOG) {
      option.options.push({ value: 'c', name: 'C' })
      configOptions.push({ id: 'effort', name: 'Effort', type: 'select', category: 'thought_level', currentValue: 'high', options: [{ value: 'high', name: 'High' }] })
    }
    respond(input.id, { configOptions })
  }
  if (input.method === 'session/prompt' && process.env.TEST_ACP_NATIVE_OUTCOME) {
    const fixture = process.env.TEST_ACP_NATIVE_OUTCOME;
    if (fixture !== 'quoted') {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(require('node:path').join(process.env.GEMINI_HOME, 'antigravity-acp', 'conversations', 'session.db'));
      db.prepare('INSERT INTO steps VALUES (?, ?, ?)').run(2, 17, Buffer.from('Error 503: auth_not_found'));
      db.close();
    }
    if (fixture !== 'receipt') process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'session',update:{sessionUpdate:'usage_update',size:8192,used:10}}})+'\\n');
    update('503 auth_');
    update('not_found');
    if (fixture === 'missing') pendingPrompt = input.id;
    else respond(input.id, {stopReason:'end_turn'});
    return;
  }
  if (input.method === 'session/prompt') { if (${nativeChildren === true}) native('running'); if (!process.env.TEST_ACP_SILENT_PROMPT) update('new'); if (${holdPrompt} || permissionKinds.length) pendingPrompt = input.id; else respond(input.id, { stopReason: 'end_turn' }); if (permissionKinds.length) requestPermission() }
  if (input.id === 'permission-' + permissionIndex && input.method === undefined) { permissionIndex++; if (permissionIndex < permissionKinds.length) requestPermission(); else respond(pendingPrompt, { stopReason: 'end_turn' }) }
  if (input.method === 'session/prompt' && ${!!nativeChildren}) setTimeout(() => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:'native-approval',method:'session/request_permission',params:{sessionId:'native-child',toolCall:{toolCallId:'native-tool',kind:'execute',title:'Child command'},options:[{optionId:'allow',name:'Allow',kind:'allow_once'},{optionId:'reject',name:'Reject',kind:'reject_once'}]}})+'\\n'),30)
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
    approve: async () => 'approve' as const,
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

it('does not report a cancelled ACP compact command as complete', async () => {
  const { cwd, launch } = await fixture(true, true, true)
  const controller = new AbortController()
  const events: string[] = []
  const input = run(cwd, launch, {
    sessionId: 'session',
    compact: true,
    signal: controller.signal,
    onText: () => controller.abort(),
    onEvent: (name) => events.push(name),
  })
  await acpAdapter.run(input.run)
  expect(controller.signal.aborted).toBe(true)
  expect(events).not.toContain('dovo/compaction/completed')
})

it('uses the installed launch, session mode and typed config values', async () => {
  const { cwd, record, launch } = await fixture()
  const boundaries: number[] = []
  const input = run(cwd, launch, {
    onTextBoundary: () => boundaries.push(input.output.join('').length),
  })
  input.run.agent.acpConfig = { ...input.run.agent.acpConfig, model: 'a' }
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

it('fails before prompting when the ACP agent leaves the requested model unchanged', async () => {
  const { cwd, launch, record } = await fixture()
  const input = run(cwd, { ...launch, env: { ...launch.env, TEST_IGNORE_ACP_MODEL: '1' } })
  await expect(acpAdapter.run(input.run)).rejects.toThrow('ACP did not apply Model: b')
  const calls = JSON.parse(await readFile(record, 'utf8'))
  expect(calls.map((call: { method: string }) => call.method)).not.toContain('session/prompt')
})

it('lists the ACP v1 models after a removed choice fails validation', async () => {
  const { cwd, launch } = await fixture()
  const input = run(cwd, launch)
  const agent = {
    ...input.run.agent,
    model: 'removed',
    acpMode: 'removed',
    acpConfig: { removedOption: 'old', toggle: 'removed' },
  }
  const catalog = await acpAdapter.models!(agent, launch)
  expect(catalog.models.map(({ id }) => id)).toEqual(['a', 'b'])
  await expect(
    acpAdapter.run({
      ...input.run,
      agent: { ...agent, acpMode: undefined, acpConfig: undefined },
    }),
  ).rejects.toThrow('ACP configuration model does not offer removed')
})

it('returns the updated ACP v1 model and reasoning options after selection', async () => {
  const { cwd, launch } = await fixture()
  const configured = { ...launch, env: { ...launch.env, TEST_MODEL_CATALOG: '1' } }
  const input = run(cwd, configured)
  const catalog = await acpAdapter.models!(input.run.agent, configured)
  expect(catalog.models.map(({ id }) => id)).toEqual(['a', 'b', 'c'])
  expect(catalog.models.find(({ id }) => id === 'b')).toMatchObject({
    isDefault: true,
    defaultReasoning: 'high',
  })
  expect(catalog.reasoning).toEqual([{ id: 'high', name: 'High' }])
})

it('discovers and applies ACP v1 mode config options without legacy session modes', async () => {
  const { cwd, launch, record } = await fixture()
  const configured = { ...launch, env: { ...launch.env, TEST_ACP_CONFIG_MODE: '1' } }
  const input = run(cwd, configured)
  const catalog = await acpAdapter.models!(input.run.agent, configured)
  expect(catalog.acp?.modes).toEqual([
    { id: 'code', name: 'Code' },
    { id: 'plan', name: 'Plan' },
  ])
  input.run.agent.permission = 'read-only'
  input.run.agent.acpMode = 'code'
  await acpAdapter.run(input.run)
  expect(input.output).toEqual(['new'])
  const messages = JSON.parse(await readFile(record, 'utf8')) as Array<{
    method: string
    params?: unknown
  }>
  expect(
    messages.find((message) => message.method === 'session/set_config_option')?.params,
  ).toEqual({
    sessionId: 'session',
    configId: 'agent_mode',
    value: 'plan',
  })
  expect(messages.map(({ method }) => method)).not.toContain('session/set_mode')
})

it('does not prompt when an ACP v1 agent fails to apply the required read-only mode', async () => {
  const { cwd, launch, record } = await fixture()
  const input = run(cwd, {
    ...launch,
    env: { ...launch.env, TEST_ACP_CONFIG_MODE: '1', TEST_IGNORE_ACP_MODE: '1' },
  })
  input.run.agent.permission = 'read-only'
  await expect(acpAdapter.run(input.run)).rejects.toThrow('ACP did not apply Mode: plan')
  const messages = JSON.parse(await readFile(record, 'utf8')) as Array<{ method: string }>
  expect(messages.map(({ method }) => method)).not.toContain('session/prompt')
})

it('applies reasoning announced after an ACP v1 legacy mode change', async () => {
  const { cwd, launch, record } = await fixture()
  const configured = { ...launch, env: { ...launch.env, TEST_ACP_MODE_EFFORT: '1' } }
  const input = run(cwd, configured)
  input.run.agent.model = ''
  const catalog = await acpAdapter.models!(input.run.agent, configured)
  expect(catalog.reasoning.map(({ id }) => id)).toEqual(['low', 'high'])
  input.run.agent.reasoning = 'high'
  await acpAdapter.run(input.run)
  const messages = JSON.parse(await readFile(record, 'utf8')) as Array<{
    method: string
    params?: unknown
  }>
  expect(messages).toContainEqual(
    expect.objectContaining({
      method: 'session/set_config_option',
      params: { sessionId: 'session', configId: 'effort', value: 'high' },
    }),
  )
})

it('detects rejected ACP v1 boolean settings in discovery and execution', async () => {
  const { cwd, launch, record } = await fixture()
  const configured = { ...launch, env: { ...launch.env, TEST_IGNORE_ACP_TOGGLE: '1' } }
  const input = run(cwd, configured)
  await expect(acpAdapter.models!(input.run.agent, configured)).rejects.toThrow(
    'ACP did not apply Toggle: true',
  )
  await expect(acpAdapter.run(input.run)).rejects.toThrow('ACP did not apply Toggle: true')
  const messages = JSON.parse(await readFile(record, 'utf8')) as Array<{ method: string }>
  expect(messages.map(({ method }) => method)).not.toContain('session/prompt')
})

it('turns Kiro Autopilot off before an ACP v1 supervised prompt', async () => {
  const { cwd, launch, record } = await fixture()
  const input = run(cwd, {
    ...launch,
    args: [...launch.args, '--agent-engine=v3'],
    env: { ...launch.env, TEST_ACP_KIRO: '1' },
  })
  input.run.agent.acpInstallationId = 'kiro'
  input.run.agent.acpConfig = { autopilot: 'on' }
  await acpAdapter.run(input.run)
  const messages = JSON.parse(await readFile(record, 'utf8')) as Array<{
    method: string
    params?: { configId?: string; value?: string }
  }>
  expect(messages.find(({ params }) => params?.configId === 'autopilot')?.params?.value).toBe('off')
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

it('applies Antigravity model and reasoning changes in the same idle session', async () => {
  const { cwd, record, launch } = await fixture(false, true)
  const adapter = createAcpAdapter()
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  const input = run(
    cwd,
    { ...launch, env: { ...launch.env, TEST_ACP_THINKING: '1', TEST_ACP_CONFIG_MODE: '1' } },
    {
      taskId: 'antigravity-selection',
    },
  )
  const agent = { ...input.run.agent, acpInstallationId: 'antigravity-acp', reasoning: 'high' }
  try {
    await adapter.run({ ...input.run, agent })
    const resume = { ...input.run, sessionId: 'session' }
    await adapter.run({ ...resume, agent: { ...agent, model: 'a' } })
    await adapter.run({ ...resume, agent: { ...agent, model: 'a', reasoning: 'low' } })
    const messages: Array<{
      method: string
      params: { configId?: string; value?: string | boolean }
    }> = JSON.parse(await readFile(record, 'utf8'))
    expect(
      messages.map(({ method }) => method).filter((method) => method.startsWith('session/')),
    ).toEqual([
      'session/new',
      'session/set_config_option',
      'session/set_config_option',
      'session/set_config_option',
      'session/set_config_option',
      'session/prompt',
      'session/set_config_option',
      'session/set_config_option',
      'session/prompt',
      'session/set_config_option',
      'session/prompt',
    ])
    expect(
      messages
        .filter(({ method }) => method === 'session/set_config_option')
        .map(({ params }) => [params.configId, params.value]),
    ).toEqual([
      ['model', 'b'],
      ['effort', 'high'],
      ['toggle', true],
      ['agent_mode', 'plan'],
      ['model', 'a'],
      ['effort', 'high'],
      ['effort', 'low'],
    ])
    expect(input.output).toEqual(['new', 'new', 'new'])

    await adapter.run({
      ...resume,
      agent: { ...agent, model: 'a', reasoning: 'low', configDirectory: 'another-profile' },
    })
    const restarted: Array<{ method: string }> = JSON.parse(await readFile(record, 'utf8'))
    expect(restarted.map(({ method }) => method).slice(0, 2)).toEqual([
      'initialize',
      'session/resume',
    ])
  } finally {
    await adapter.dispose?.()
    pressure.mockRestore()
  }
})

async function antigravityFailureFixture(mode: 'receipt' | 'missing' | 'quoted') {
  const { cwd, launch } = await fixture(false, true)
  const profile = join(cwd, 'profile')
  const directory = join(profile, 'antigravity-acp', 'conversations')
  await mkdir(directory, { recursive: true })
  const db = new Database(join(directory, 'session.db'))
  try {
    db.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, step_payload BLOB)')
    db.prepare('INSERT INTO steps VALUES (?, ?, ?)').run(1, 17, Buffer.from('503 auth_not_found'))
  } finally {
    db.close()
  }
  const input = run(
    cwd,
    {
      ...launch,
      env: { ...launch.env, GEMINI_HOME: profile, TEST_ACP_NATIVE_OUTCOME: mode },
    },
    { signal: AbortSignal.timeout(1500) },
  )
  input.run.agent.acpInstallationId = 'antigravity-acp'
  return input
}

it.each(['receipt', 'missing'] as const)(
  'reports a current Antigravity auth failure with %s ACP receipt',
  async (mode) => {
    const { run } = await antigravityFailureFixture(mode)
    await expect(acpAdapter.run(run)).rejects.toMatchObject({
      kind: 'authentication',
      message: expect.stringContaining('503 auth_not_found'),
    })
    expect(run.signal.aborted).toBe(false)
  },
)

it('does not use quota updates, quoted errors or an older Antigravity log row as a terminal failure', async () => {
  const input = await antigravityFailureFixture('quoted')
  await acpAdapter.run(input.run)
  expect(input.output.join('')).toBe('503 auth_not_found')
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
  const approve = vi.fn<AgentRun['approve']>(async () => 'deny' as const)
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
it('classifies ACP fetch permissions independently of display titles and keeps edits supervised', async () => {
  const { cwd, launch } = await fixture(false, false, false, ['fetch', 'edit', 'execute'])
  const approve = vi.fn<AgentRun['approve']>(async () => 'approve' as const)
  const input = run(cwd, launch, { approve })
  input.run.agent.permission = 'ask'
  await acpAdapter.run(input.run)
  expect(approve.mock.calls.map(([title, , kind]) => ({ title, kind }))).toEqual([
    { title: 'Tool request', kind: 'web' },
    { title: 'Tool request', kind: undefined },
    { title: 'Tool request', kind: undefined },
  ])
})

it('acknowledges cancellation without treating it as prompt acceptance', async () => {
  const { cwd, record, launch } = await fixture(true)
  const controller = new AbortController()
  const onPromptAccepted = vi.fn<() => void>()
  const input = run(
    cwd,
    { ...launch, env: { ...launch.env, TEST_ACP_SILENT_PROMPT: '1' } },
    { signal: controller.signal, onPromptAccepted },
  )
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
  expect(onPromptAccepted).not.toHaveBeenCalled()
})

it.each([true, false])(
  'restores a child announced before resume/load returns (resume=%s)',
  async (resume) => {
    const f = await fixture(false, resume, false, [], 'replay')
    const adapter = createAcpAdapter()
    const events = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
    const approve = vi.fn<NonNullable<AgentRun['nativeAgentInteractions']>['approve']>(
      async () => 'approve',
    )
    let control: Parameters<NonNullable<AgentRun['onNativeSession']>>[0] | undefined
    const input = run(f.cwd, f.launch, {
      taskId: 'restored-thread',
      sessionId: 'session',
      onSubagentEvent: events,
      onNativeSession: (session) => {
        control = session
      },
      nativeAgentInteractions: { approve, ask: async () => null },
    })
    try {
      await adapter.run(input.run)
      expect(input.output).toEqual(['new'])
      expect(events).toHaveBeenCalledWith(
        'subagent_update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionId: 'native-child',
            state: { state: 'running' },
          }),
        }),
        'session',
      )
      await vi.waitFor(() => expect(approve).toHaveBeenCalledOnce())
      await control?.stop('native-child')
      await vi.waitFor(() =>
        expect(events).toHaveBeenCalledWith(
          'subagent_update',
          expect.objectContaining({
            update: expect.objectContaining({
              sessionId: 'native-child',
              state: { state: 'idle' },
            }),
          }),
          'session',
        ),
      )
    } finally {
      await adapter.dispose?.()
    }
  },
)

it('keeps ACP child traffic and controls connected after the parent returns and under pressure', async () => {
  const f = await fixture(false, false, false, [], true)
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(true)
  const approve = vi.fn<NonNullable<AgentRun['nativeAgentInteractions']>['approve']>(
    async () => 'approve' as const,
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

it('reports a real idle process exit to the current owner after warm-session reuse', async () => {
  const f = await fixture(false, false, false, [], true)
  const adapter = createAcpAdapter()
  const first = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
  const current = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
  let child: Parameters<NonNullable<AgentRun['onOwnedProcess']>>[0] | undefined
  const input = run(f.cwd, f.launch, {
    taskId: 'rebound',
    onSubagentEvent: first,
    onOwnedProcess: (value) => {
      child = value
    },
  })
  try {
    await adapter.run(input.run)
    await adapter.run({ ...input.run, sessionId: 'session', onSubagentEvent: current })
    if (!child) throw new Error('Missing provider process')
    child.kill()
    await vi.waitFor(() =>
      expect(current).toHaveBeenCalledWith('dovo/session/closed', {}, 'session'),
    )
    expect(first).not.toHaveBeenCalledWith('dovo/session/closed', {}, 'session')
  } finally {
    await adapter.dispose?.()
  }
})

it.each(['on-request', 'never'] as const)(
  'honors explicit %s in ACP native permission requests',
  async (approvalPolicy) => {
    const { cwd, record, launch } = await fixture(false, false, false, ['edit', 'execute'])
    const approve = vi.fn<AgentRun['approve']>(async () => 'deny')
    const input = run(cwd, launch, { approve })
    input.run.agent.permission = 'workspace-write'
    input.run.agent.approvalPolicy = approvalPolicy
    await acpAdapter.run(input.run)
    const messages: Array<{ id?: string; result?: { outcome?: { optionId?: string } } }> =
      JSON.parse(await readFile(record, 'utf8'))
    for (const id of ['permission-0', 'permission-1'])
      expect(messages.find((message) => message.id === id)?.result?.outcome?.optionId).toBe(
        approvalPolicy === 'never' ? 'allow' : 'reject',
      )
    expect(approve).toHaveBeenCalledTimes(approvalPolicy === 'never' ? 0 : 2)
  },
)

it.each([true, false])(
  'negotiates opted-in MCP-over-ACP only when advertised=%s, retaining HTTP fallback',
  async (supported) => {
    const adapter = createAcpAdapter()
    const { cwd, launch, record } = await fixture(false, false, false, [], false, {
      acp: supported,
      http: true,
    })
    const input = run(cwd, launch)
    input.run.taskId = 'mcp-task'
    input.run.agent.resources = decode(resourceSettingsSchema, {
      mcpServers: [
        {
          name: 'native',
          enabled: true,
          transport: 'http',
          acpTransport: true,
          url: 'http://127.0.0.1:1234/mcp',
          headerValues: { Authorization: 'Bearer fixture-secret' },
        },
      ],
    })
    try {
      await adapter.run(input.run)
      await adapter.run({ ...input.run, sessionId: 'session' })
      const messages: Array<{
        method: string
        params?: {
          protocolVersion?: number
          mcpServers?: Array<{ type?: string; serverId?: string }>
        }
      }> = JSON.parse(await readFile(record, 'utf8'))
      expect(
        messages.find((message) => message.method === 'initialize')?.params?.protocolVersion,
      ).toBe(1)
      const declarations = messages.find((message) => message.method === 'session/new')?.params
        ?.mcpServers
      expect(declarations?.[0].type).toBe(supported ? 'acp' : 'http')
      expect(Boolean(declarations?.[0].serverId)).toBe(supported)
      expect(JSON.stringify(declarations).includes('fixture-secret')).toBe(!supported)
    } finally {
      await adapter.dispose?.()
    }
  },
)

it('rejects tool-free image review before prompting an agent without image capability', async () => {
  const { cwd, launch, record } = await fixture()
  const { run: input } = run(cwd, launch, { tools: 'none' })
  input.attachments = [
    {
      id: 'image',
      name: 'shot.png',
      mime: 'image/png',
      size: 1,
      path: join(cwd, 'shot.png'),
      data: 'AA==',
    },
  ]
  await expect(acpAdapter.run(input)).rejects.toThrow('does not accept image input')
  const messages = JSON.parse(await readFile(record, 'utf8')) as { method?: string }[]
  expect(messages.some((message) => message.method === 'session/prompt')).toBe(false)
})
