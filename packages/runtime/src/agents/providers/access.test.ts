import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { supportsAccess } from '@dovo/protocol'
import type { AgentRun } from '../types'
import { codexAdapter } from './codex'
import { claudeAdapter } from './claude'
const captured = vi.hoisted(() => ({ options: [] as Options[] }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ options }: { options: Options }) => {
    captured.options.push(options)
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'result', subtype: 'success', is_error: false }
      },
      close() {},
    }
  },
}))
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  captured.options.length = 0
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
function run(permission: AgentRun['agent']['permission']): AgentRun {
  return {
    agent: {
      id: 'agent',
      name: 'Test',
      provider: 'codex',
      model: '',
      endpoint: '',
      instructions: '',
      permission,
    },
    cwd: tmpdir(),
    prompt: 'test',
    signal: new AbortController().signal,
    onSession() {},
    onText() {},
    onActivity() {},
    approve: vi.fn<AgentRun['approve']>(async () => false),
    ask: vi.fn<AgentRun['ask']>(async () => null),
  }
}
it.each([
  ['ask', 'on-request', 'read-only', 'user', false],
  ['workspace-write', 'on-request', 'workspace-write', 'user', false],
  ['auto', 'on-request', 'workspace-write', 'auto_review', false],
  ['full-access', 'never', 'danger-full-access', 'user', false],
  ['read-only', 'never', 'read-only', 'user', false],
  ['read-only', 'never', 'read-only', 'user', true],
] as const)(
  'sends the distinct Codex policy and selected service tier for %s',
  async (permission, approvalPolicy, sandbox, approvalsReviewer, textOnly) => {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-access-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const executable = join(directory, 'harness')
    await writeFile(
      executable,
      `#!${process.execPath}
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 if(m.method==='thread/start'){
  const expected=${JSON.stringify({ approvalPolicy, sandbox, approvalsReviewer, serviceTier: 'fixture-priority', ...(textOnly ? { ephemeral: true, config: { 'features.shell_tool': false, web_search: 'disabled' } } : {}) })};
  if(Object.keys(expected).some(k=>JSON.stringify(m.params[k])!==JSON.stringify(expected[k]))){send({id:m.id,error:{code:-1,message:'Wrong permission policy'}});return;}
  send({id:m.id,result:{thread:{id:'t'},approvalPolicy:expected.approvalPolicy,approvalsReviewer:expected.approvalsReviewer,sandbox:{type:'dangerFullAccess'}}});return;
 }
 if(m.method==='turn/start'&&m.params.serviceTier!=='fixture-priority'){send({id:m.id,error:{code:-1,message:'Missing service tier'}});return;}
 send({id:m.id,result:{}});
 if(m.method==='turn/start')send({method:'turn/completed',params:{turn:{status:'completed'}}});
});`,
      { mode: 0o700 },
    )
    const input = run(permission)
    if (textOnly) input.tools = 'none'
    input.agent.endpoint = executable
    input.agent.serviceTier = 'fixture-priority'
    await codexAdapter.run(input)
    expect(input.approve).not.toHaveBeenCalled()
  },
)
it.each([
  ['ask', 'default'],
  ['workspace-write', 'acceptEdits'],
  ['auto', 'auto'],
  ['full-access', 'bypassPermissions'],
  ['read-only', 'default'],
] as const)('uses native Claude mode for %s', async (permission, mode) => {
  await claudeAdapter.run(run(permission))
  expect(captured.options[0].permissionMode).toBe(mode)
  expect(captured.options[0].allowDangerouslySkipPermissions).toBe(
    permission === 'full-access' ? true : undefined,
  )
})
it('does not advertise harness review where the integration cannot enforce it', () => {
  expect(supportsAccess('opencode', 'auto')).toBe(false)
  expect(supportsAccess('acp', 'auto')).toBe(false)
  expect(supportsAccess('acp', 'full-access')).toBe(false)
  expect(supportsAccess('codex', 'auto')).toBe(true)
  expect(supportsAccess('claude', 'auto')).toBe(true)
})

it('disables Claude built-ins and inherited MCP servers for text-only utility turns', async () => {
  const input = run('read-only')
  input.tools = 'none'
  input.agent.instructions = 'Punctuate only'
  await claudeAdapter.run(input)
  const options = captured.options[0]
  expect(options.tools).toEqual([])
  expect(options.strictMcpConfig).toBe(true)
  expect(options.mcpServers).toEqual({})
  expect(options.systemPrompt).toBe('Punctuate only')
  expect(
    await options.canUseTool?.(
      'Read',
      {},
      { signal: input.signal, toolUseID: 'read', requestId: 'request' },
    ),
  ).toMatchObject({ behavior: 'deny' })
  expect(input.approve).not.toHaveBeenCalled()
})

it.each(['auto', 'full-access'] as const)(
  'rejects Codex %s when the harness does not confirm the mode',
  async (permission) => {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-access-unsupported-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const executable = join(directory, 'harness')
    await writeFile(
      executable,
      `#!${process.execPath}
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id!==undefined)process.stdout.write(JSON.stringify({id:m.id,result:{thread:{id:'old-harness'}}})+'\\n')});`,
      { mode: 0o700 },
    )
    const input = run(permission)
    input.agent.endpoint = executable
    input.onSession = vi.fn<AgentRun['onSession']>()
    await expect(codexAdapter.run(input)).rejects.toThrow('This Codex harness did not')
    expect(input.onSession).not.toHaveBeenCalled()
  },
)
