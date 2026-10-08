import { mutableStruct } from '@dovo/protocol'
import { decode, resourceSettingsSchema } from '@dovo/protocol'
import { taskToolsServer } from '../../../agent-tools/config.js'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import type { AgentRun } from '../../execution/types'
import * as warmProcesses from '../../execution/warm-processes'
import { codexAdapter } from './codex'
const cleanups: string[] = []
afterEach(async () => {
  for (const dir of cleanups.splice(0))
    await rm(dir, {
      recursive: true,
      force: true,
    })
})
async function fixture(
  version = '0.155.1',
  savedDaybreak = false,
  slowShutdown = false,
  compactBeforeResponse = false,
  lateChild = false,
) {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-codex-modes-'))
  cleanups.push(directory)
  const executable = join(directory, 'codex')
  const log = join(directory, 'requests.jsonl')
  await writeFile(
    executable,
    `#!${process.execPath}
const fs=require('node:fs');
if (${slowShutdown}) {
 process.on('SIGTERM', () => setTimeout(() => fs.writeFileSync(${JSON.stringify(join(directory, 'late.txt'))}, 'saved'), 150));
 setInterval(() => {}, 1000);
}
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
let mcpServers;
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({...m,pid:process.pid})+'\\n');
 let result={};
 if(m.method==='initialize')result={userAgent:'codex/${version}'};
 if(m.method==='thread/start'||m.method==='thread/resume') {
   result={thread:{id:'thread',daybreakEnabled:${savedDaybreak}},approvalsReviewer:'user'};
   // A loaded Codex thread retains the original MCP connection on resume.
   mcpServers ??= m.params.config?.mcp_servers ?? {};
 }
 if(m.method==='thread/compact/start' && ${compactBeforeResponse})send({method:'item/completed',params:{threadId:'thread',item:{type:'contextCompaction',id:'compact'}}});
 send({id:m.id,result});
 if(m.method==='turn/start') {
   send({method:'item/agentMessage/delta',params:{delta:JSON.stringify(mcpServers.dovo_task?.env ?? {})}});
   send({method:'turn/completed',params:{turn:{status:'completed'}}});
   if (${lateChild}) setTimeout(() => send({method:'item/started',params:{threadId:'native-child',item:{type:'commandExecution'}}}), 50);
 }
 if(m.method==='thread/compact/start' && !${compactBeforeResponse})send({method:'item/completed',params:{threadId:'thread',item:{type:'contextCompaction',id:'compact'}}});
});`,
    {
      mode: 0o700,
    },
  )
  const run: AgentRun = {
    agent: {
      id: 'agent',
      name: 'Test',
      provider: 'codex',
      endpoint: executable,
      model: 'gpt-6-astra',
      permission: 'ask',
      instructions: '',
    },
    cwd: directory,
    prompt: 'Fixture only',
    signal: new AbortController().signal,
    onSession: vi.fn<AgentRun['onSession']>(),
    onPromptAccepted: vi.fn<NonNullable<AgentRun['onPromptAccepted']>>(),
    onText: vi.fn<AgentRun['onText']>(),
    onActivity: vi.fn<AgentRun['onActivity']>(),
    approve: vi.fn<AgentRun['approve']>(async () => false),
    ask: vi.fn<AgentRun['ask']>(async () => null),
  }
  const requests = async () =>
    (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) =>
        decode(
          mutableStruct({
            method: Schema.String,
            pid: Schema.Number,
            params: Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)),
          }),
          JSON.parse(line),
        ),
      )
  return {
    run,
    requests,
  }
}
it('reuses the Codex app-server for follow-up turns and closes it with the adapter', async () => {
  const { run, requests } = await fixture()
  run.taskId = 'warm-task'
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  try {
    await codexAdapter.run(run)
    run.sessionId = 'thread'
    await codexAdapter.run(run)
    const rows = await requests()
    expect(new Set(rows.map((row) => row.pid)).size).toBe(1)
    expect(rows.filter((row) => row.method === 'initialize')).toHaveLength(1)
    expect(rows.filter((row) => row.method === 'turn/start')).toHaveLength(2)
  } finally {
    await codexAdapter.dispose?.()
    pressure.mockRestore()
  }
})
it('rebinds Dovo task tools before a follow-up turn while resuming the same conversation', async () => {
  const { run, requests } = await fixture()
  run.taskId = 'bound-task'
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  const bind = (attempt: string) => {
    run.agent.resources = decode(resourceSettingsSchema, {
      mcpServers: [
        taskToolsServer('bound-task', 1234, 'token', '127.0.0.1', false, false, attempt),
      ],
    })
  }
  try {
    bind('first-run')
    await codexAdapter.run(run)
    expect(run.onText).toHaveBeenLastCalledWith(expect.stringContaining('first-run'))
    expect((await requests()).find((row) => row.method === 'thread/start')?.params).toMatchObject({
      config: {
        mcp_servers: {
          dovo_task: {
            tools: {
              subagent_spawn: { approval_mode: 'approve' },
              subagent_list: { approval_mode: 'approve' },
              subagent_read: { approval_mode: 'approve' },
              subagent_wait: { approval_mode: 'approve' },
              subagent_cancel: { approval_mode: 'approve' },
            },
          },
        },
      },
    })
    run.sessionId = 'thread'
    await codexAdapter.run(run)
    expect(new Set((await requests()).map((row) => row.pid)).size).toBe(1)

    bind('second-run')
    await codexAdapter.run(run)
    expect(run.onText).toHaveBeenLastCalledWith(expect.stringContaining('second-run'))
    const rows = await requests()
    expect(new Set(rows.map((row) => row.pid)).size).toBe(2)
    expect(rows.filter((row) => row.method === 'thread/start')).toHaveLength(1)
    expect(rows.filter((row) => row.method === 'thread/resume').at(-1)?.params.threadId).toBe(
      'thread',
    )

    run.agent.resources = decode(resourceSettingsSchema, {})
    await codexAdapter.run(run)
    expect(run.onText).toHaveBeenLastCalledWith('{}')
    expect(new Set((await requests()).map((row) => row.pid)).size).toBe(3)
  } finally {
    await codexAdapter.dispose?.()
    pressure.mockRestore()
  }
})
it('compacts an existing thread without starting a model turn', async () => {
  const { run, requests } = await fixture()
  run.sessionId = 'thread'
  run.compact = true
  const events: string[] = []
  run.onEvent = (name) => events.push(name)
  await codexAdapter.run(run)
  const rows = await requests()
  expect(rows.find((row) => row.method === 'thread/compact/start')?.params).toEqual({
    threadId: 'thread',
  })
  expect(rows.some((row) => row.method === 'turn/start')).toBe(false)
  expect(events).toContain('item/completed')
})
it('accepts a compaction event before the compact request response', async () => {
  const { run } = await fixture('0.155.1', false, false, true)
  run.sessionId = 'thread'
  run.compact = true
  await expect(codexAdapter.run(run)).resolves.toBeUndefined()
})
it('enables advertised Fast per run, then explicitly resets a resumed thread and turn to Standard', async () => {
  const { run, requests } = await fixture()
  run.agent.serviceTier = 'priority'
  await codexAdapter.run(run)
  run.sessionId = 'thread'
  run.agent.serviceTier = ''
  await codexAdapter.run(run)
  const rows = await requests()
  expect(rows.find((row) => row.method === 'thread/start')?.params).toMatchObject({
    serviceTier: 'priority',
    config: {
      'features.fast_mode': true,
    },
  })
  expect(rows.find((row) => row.method === 'thread/resume')?.params).toMatchObject({
    serviceTier: 'default',
  })
  expect(
    rows.filter((row) => row.method === 'turn/start').map((row) => row.params.serviceTier),
  ).toEqual(['priority', 'default'])
})
it.each(['daybreakBlue', 'daybreakRed', 'standard'] as const)(
  'persists %s and sends the exact turn treatment without altering access',
  async (program) => {
    const { run, requests } = await fixture()
    run.agent.cyberAccessProgram = program
    await codexAdapter.run(run)
    const rows = await requests()
    expect(rows.find((row) => row.method === 'thread/start')?.params).toMatchObject({
      approvalsReviewer: 'user',
      approvalPolicy: 'on-request',
      sandbox: 'read-only',
    })
    expect(rows.find((row) => row.method === 'thread/metadata/update')?.params).toEqual({
      threadId: 'thread',
      daybreakEnabled: program !== 'standard',
    })
    expect(rows.find((row) => row.method === 'turn/start')?.params.cyberAccessProgram).toBe(program)
  },
)
it('leaves Automatic omitted and never inherits a custom agent Daybreak override in utility turns', async () => {
  const { run, requests } = await fixture()
  await codexAdapter.run(run)
  run.agent.cyberAccessProgram = 'daybreakBlue'
  run.tools = 'none'
  await codexAdapter.run(run)
  const rows = await requests()
  expect(rows.some((row) => row.method === 'thread/metadata/update')).toBe(false)
  expect(
    rows
      .filter((row) => row.method === 'turn/start')
      .every((row) => !('cyberAccessProgram' in row.params)),
  ).toBe(true)
})
it('starts a title-style utility turn as an ephemeral Codex thread even with tools available', async () => {
  const { run, requests } = await fixture()
  run.ephemeral = true
  await codexAdapter.run(run)
  const rows = await requests()
  expect(rows.find((row) => row.method === 'thread/start')?.params.ephemeral).toBe(true)
})
it('fails before a turn on older harnesses that could silently ignore Daybreak', async () => {
  const { run, requests } = await fixture('0.150.0')
  run.agent.cyberAccessProgram = 'daybreakBlue'
  await expect(codexAdapter.run(run)).rejects.toThrow('Daybreak mode requires Codex 0.155.1')
  expect((await requests()).some((row) => row.method === 'turn/start')).toBe(false)
})
it('clears an old persisted Daybreak choice when a resumed task returns to Automatic', async () => {
  const { run, requests } = await fixture('0.155.1', true)
  run.sessionId = 'thread'
  await codexAdapter.run(run)
  const rows = await requests()
  expect(rows.find((row) => row.method === 'thread/metadata/update')?.params).toEqual({
    threadId: 'thread',
    daybreakEnabled: false,
  })
  expect(rows.find((row) => row.method === 'turn/start')?.params).not.toHaveProperty(
    'cyberAccessProgram',
  )
})

it.skipIf(process.platform === 'win32')(
  'waits for owned Codex shutdown before returning a completed run',
  async () => {
    const { run } = await fixture('0.155.1', false, true)
    await codexAdapter.run(run)
    expect(run.onPromptAccepted).toHaveBeenCalled()
    expect(await readFile(join(run.cwd, 'late.txt'), 'utf8')).toBe('saved')
  },
)

it('keeps native-agent notifications subscribed after the root turn finishes', async () => {
  const { run } = await fixture('0.155.1', false, false, false, true)
  run.taskId = 'late-native-codex'
  const native = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
  const events = vi.fn<NonNullable<AgentRun['onEvent']>>()
  run.onSubagentEvent = native
  run.onEvent = events
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  try {
    await codexAdapter.run(run)
    await vi.waitFor(() =>
      expect(native).toHaveBeenCalledWith(
        'item/started',
        expect.objectContaining({ threadId: 'native-child' }),
        'thread',
      ),
    )
    expect(events).not.toHaveBeenCalledWith(
      'item/started',
      expect.objectContaining({ threadId: 'native-child' }),
    )
    await codexAdapter.dispose?.()
    expect(native).toHaveBeenCalledWith('dovo/session/closed', {}, 'thread')
  } finally {
    await codexAdapter.dispose?.()
    pressure.mockRestore()
  }
})
