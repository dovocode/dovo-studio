import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import {
  decode,
  defaultTaskHarness,
  mutableArray,
  mutableStruct,
  type ApprovalPolicy,
  type SandboxMode,
} from '@dovo/protocol'
import type { AgentAdapter, AgentRun } from '../../execution/types.js'
import { createCodexAdapter } from '../codex/codex.js'
import { createClaudeAdapter } from '../claude/claude.js'
import { createAcpAdapter } from '../acp/acp.js'
import { createCopilotAdapter } from '../copilot/copilot.js'
import { createOpenCodeAdapter } from '../opencode/opencode.js'
import { createCursorAdapter } from '../cursor/cursor.js'
import { createHermesAdapter } from '../hermes/hermes.js'
import { createGrokAdapter } from '../grok/grok.js'
import { createMuseAdapter } from '../muse/muse.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
function input(provider: AgentRun['agent']['provider']): AgentRun {
  return {
    agent: {
      ...defaultTaskHarness(provider),
      id: 'fixture',
      name: 'Fixture',
      endpoint: '/nonexistent-policy-fixture',
    },
    cwd: tmpdir(),
    prompt: 'Fixture only',
    signal: new AbortController().signal,
    onText() {},
    onSession() {},
    onActivity() {},
    approve: vi.fn<AgentRun['approve']>(async () => 'approve'),
    ask: async () => null,
  }
}
const adapters: Array<[AgentRun['agent']['provider'], () => AgentAdapter]> = [
  ['claude', createClaudeAdapter],
  ['acp', createAcpAdapter],
  ['copilot', createCopilotAdapter],
  ['opencode', createOpenCodeAdapter],
  ['cursor', createCursorAdapter],
  ['hermes', createHermesAdapter],
  ['grok', createGrokAdapter],
  ['muse', createMuseAdapter],
]
it.each(adapters)(
  'rejects unsupported %s native guarantees before process launch',
  async (provider, create) => {
    const adapter = create()
    cleanups.push(async () => {
      await adapter.dispose?.()
    })
    const run = input(provider)
    run.agent.sandboxMode = 'workspace-write'
    await expect(adapter.run(run)).rejects.toThrow(
      `${provider} does not support sandbox mode workspace-write`,
    )
    run.agent.sandboxMode = undefined
    run.agent.approvalPolicy = 'on-failure'
    await expect(adapter.run(run)).rejects.toThrow(
      `${provider} does not support approval policy on-failure`,
    )
    expect(run.approve).not.toHaveBeenCalled()
  },
)

async function nativeFixture(
  options: {
    mismatch?: boolean
    callback?: boolean
    grantRoot?: boolean
    widenedRoots?: boolean
  } = {},
) {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-native-policy-'))
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  const executable = join(cwd, 'codex')
  const wire = join(cwd, 'wire.jsonl')
  await writeFile(
    executable,
    `#!${process.execPath}
const fs=require('node:fs');
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 fs.appendFileSync(${JSON.stringify(wire)},JSON.stringify(m)+'\\n');
 if(m.id===undefined)return;
 if(m.method===undefined){send({method:'turn/completed',params:{turn:{status:'completed'}}});return;}
 if(m.method==='thread/start'||m.method==='thread/resume'){
   send({id:m.id,result:{thread:{id:'fixture'},approvalPolicy:m.params.approvalPolicy,
    approvalsReviewer:m.params.approvalsReviewer,
    sandbox:{type:${options.mismatch === true}?'dangerFullAccess':({'read-only':'readOnly','workspace-write':'workspaceWrite','danger-full-access':'dangerFullAccess'})[m.params.sandbox], writableRoots: ${options.widenedRoots === true} ? ['/outside'] : [m.params.cwd]}}});return;
 }
 send({id:m.id,result:{}});
 if(m.method==='turn/start'){
  if(${options.callback === true})send({id:'approval',method:'item/commandExecution/requestApproval',params:{threadId:'fixture',...(${options.grantRoot === true} ? {grantRoot:'/outside'} : {additionalPermissions:{fileSystem:{write:['/outside']}}})}});
  else send({method:'turn/completed',params:{turn:{status:'completed'}}});
 }
});`,
    { mode: 0o700 },
  )
  const run = input('codex')
  run.cwd = cwd
  run.agent.endpoint = executable
  const adapter = createCodexAdapter()
  cleanups.push(async () => {
    await adapter.dispose?.()
  })
  const messages = async () =>
    decode(
      mutableArray(
        mutableStruct({
          method: Schema.optional(Schema.String),
          id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
          params: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
          result: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
        }),
      ),
      (await readFile(wire, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    )
  return { adapter, run, messages }
}
const cases: Array<[ApprovalPolicy, SandboxMode]> = (
  ['untrusted', 'on-failure', 'on-request', 'never'] as const
).flatMap((approval) =>
  (['read-only', 'workspace-write', 'danger-full-access'] as const).map(
    (sandbox) => [approval, sandbox] satisfies [ApprovalPolicy, SandboxMode],
  ),
)
it.each(cases)(
  'applies native Codex %s / %s on both thread and turn',
  async (approvalPolicy, sandboxMode) => {
    const f = await nativeFixture()
    f.run.agent.approvalPolicy = approvalPolicy
    f.run.agent.sandboxMode = sandboxMode
    await f.adapter.run(f.run)
    const messages = await f.messages()
    expect(messages.find((m) => m.method === 'thread/start')?.params).toMatchObject({
      approvalPolicy: sandboxMode === 'read-only' ? 'never' : approvalPolicy,
      sandbox: sandboxMode,
      approvalsReviewer: 'user',
    })
    const nativeSandbox = {
      'read-only': 'readOnly',
      'workspace-write': 'workspaceWrite',
      'danger-full-access': 'dangerFullAccess',
    }[sandboxMode]
    expect(messages.find((m) => m.method === 'turn/start')?.params).toMatchObject({
      approvalPolicy: sandboxMode === 'read-only' ? 'never' : approvalPolicy,
      sandboxPolicy: { type: nativeSandbox },
    })
    expect(messages.find((m) => m.method === 'thread/start')?.params?.config).toEqual(
      sandboxMode === 'workspace-write'
        ? { 'sandbox_workspace_write.writable_roots': [f.run.cwd] }
        : undefined,
    )
  },
)
it('refuses silently widened native settings before a prompt', async () => {
  const f = await nativeFixture({ mismatch: true })
  f.run.agent.approvalPolicy = 'on-request'
  f.run.agent.sandboxMode = 'workspace-write'
  await expect(f.adapter.run(f.run)).rejects.toThrow('did not apply')
  expect((await f.messages()).some((m) => m.method === 'turn/start')).toBe(false)
})
it.each([false, true])(
  'hard read-only restrictions dominate native overrides (text only %s)',
  async (textOnly) => {
    const f = await nativeFixture({ callback: true })
    f.run.agent.permission = textOnly ? 'full-access' : 'read-only'
    f.run.agent.approvalPolicy = 'on-failure'
    f.run.agent.sandboxMode = 'danger-full-access'
    if (textOnly) f.run.tools = 'none'
    await f.adapter.run(f.run)
    expect((await f.messages()).find((m) => m.method === 'thread/start')?.params).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'read-only',
    })
    expect((await f.messages()).find((m) => m.id === 'approval' && m.result)?.result).toMatchObject(
      { decision: 'decline' },
    )
    expect(f.run.approve).not.toHaveBeenCalled()
  },
)
it.each([false, true])(
  'never turns an approval callback into an unsandboxed grant (file root %s)',
  async (grantRoot) => {
    const f = await nativeFixture({ callback: true, grantRoot })
    f.run.agent.approvalPolicy = 'on-request'
    f.run.agent.sandboxMode = 'workspace-write'
    await f.adapter.run(f.run)
    expect((await f.messages()).find((m) => m.id === 'approval' && m.result)?.result).toMatchObject(
      {
        decision: 'decline',
      },
    )
    expect(f.run.approve).not.toHaveBeenCalled()
  },
)

it('refuses a native workspace-write acknowledgement with additional writable roots before prompt', async () => {
  const f = await nativeFixture({ widenedRoots: true })
  f.run.agent.sandboxMode = 'workspace-write'
  await expect(f.adapter.run(f.run)).rejects.toThrow('did not apply')
  expect((await f.messages()).some((message) => message.method === 'turn/start')).toBe(false)
})

it('lets explicit unconfined sandbox requests follow the selected approval policy', async () => {
  const f = await nativeFixture({ callback: true, grantRoot: true })
  f.run.agent.approvalPolicy = 'on-request'
  f.run.agent.sandboxMode = 'danger-full-access'
  await f.adapter.run(f.run)
  expect(
    (await f.messages()).find((message) => message.id === 'approval' && message.result)?.result,
  ).toMatchObject({ decision: 'accept' })
  expect(f.run.approve).toHaveBeenCalledOnce()
})
