import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import type { AgentRun } from '../types'
import { codexAdapter } from './codex'
const cleanups: string[] = []
afterEach(async () => {
  for (const dir of cleanups.splice(0))
    await rm(dir, {
      recursive: true,
      force: true,
    })
})
async function fixture(version = '0.155.1', savedDaybreak = false, slowShutdown = false) {
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
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');
 let result={};
 if(m.method==='initialize')result={userAgent:'codex/${version}'};
 if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:'thread',daybreakEnabled:${savedDaybreak}},approvalsReviewer:'user'};
 send({id:m.id,result});
 if(m.method==='turn/start')send({method:'turn/completed',params:{turn:{status:'completed'}}});
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
            params: Schema.mutable(
              Schema.Record({
                key: Schema.String,
                value: Schema.Unknown,
              }),
            ),
          }),
          JSON.parse(line),
        ),
      )
  return {
    run,
    requests,
  }
}
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
