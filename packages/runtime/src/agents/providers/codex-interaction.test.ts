import { decode } from '@dovo/protocol'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Schema } from 'effect'
import type { AgentRun, AgentSteer } from '../types'
import { codexAdapter } from './codex'
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, {
      recursive: true,
      force: true,
    })
})
async function fixture(
  mode: 'steer' | 'question' | 'clear-question' | 'reject-steer' | 'message-form' | 'child-events',
) {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-codex-interaction-'))
  directories.push(directory)
  const executable = join(directory, 'codex')
  const log = join(directory, 'messages.jsonl')
  await writeFile(
    executable,
    `#!${process.execPath}
const fs = require('node:fs');
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
const complete = () => send({method:'turn/completed',params:{turn:{id:'turn-1',status:'completed'}}});
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);
 fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');
 if(m.id==='question-1') { complete(); return; }
 if(m.id===undefined) return;
 if(m.method==='initialize') send({id:m.id,result:{userAgent:'codex/0.155.1'}});
 else if(m.method==='thread/start') send({id:m.id,result:{thread:{id:'thread-1'}}});
 else if(m.method==='turn/start') {
   send({id:m.id,result:{turn:{id:'turn-1',status:'inProgress'}}});
   if(${JSON.stringify(mode)}==='child-events') {
     send({method:'item/agentMessage/delta',params:{threadId:'child',delta:'Child output'}});
     send({method:'turn/completed',params:{threadId:'child',turn:{id:'child-turn',status:'completed'}}});
     setTimeout(() => { send({method:'item/agentMessage/delta',params:{threadId:'thread-1',delta:'Parent output'}}); complete(); }, 30);
   }
   if(${JSON.stringify(mode)}==='message-form') {
     const item={type:'agentMessage',id:'async-form',text:'',questions:[{title:'Which output style?',options:['Compact','Detailed']},{title:'Any additional context?',options:null}]};
     send({method:'item/started',params:{item}});
     send({method:'item/completed',params:{item}});
     complete();
   }
   if(${JSON.stringify(mode)}.includes('question')) {
     send({id:'question-1',method:'item/tool/requestUserInput',params:{threadId:'thread-1',turnId:'turn-1',itemId:'question-item',isBlocking:false,autoResolutionMs:null,questions:[{id:'direction',header:'Direction',question:'How should we proceed?',isOther:true,isSecret:false,options:[{label:'Small change',description:'Keep the scope focused'},{label:'Larger change',description:'Update related parts'}]}]}});
     send({method:'item/agentMessage/delta',params:{delta:'Continuing independent work'}});
     if(${JSON.stringify(mode)}==='clear-question') send({method:'serverRequest/resolved',params:{threadId:'thread-1',requestId:'question-1'}});
   }
 } else if(m.method==='turn/steer') {
   if(${JSON.stringify(mode)}==='reject-steer') send({id:m.id,error:{code:-32000,message:'Expected turn is no longer active'}});
   else send({id:m.id,result:{turnId:'turn-1'}});
   complete();
 } else send({id:m.id,result:{}});
});`,
    {
      mode: 0o700,
    },
  )
  const controller = new AbortController()
  const run: AgentRun = {
    agent: {
      id: 'fixture',
      name: 'Fixture',
      provider: 'codex',
      endpoint: executable,
      model: 'gpt-6-astra',
      permission: 'ask',
      instructions: '',
    },
    cwd: directory,
    prompt: 'Local protocol fixture',
    signal: controller.signal,
    onSession: vi.fn<AgentRun['onSession']>(),
    onActivity: vi.fn<AgentRun['onActivity']>(),
    onText: vi.fn<AgentRun['onText']>(),
    approve: async () => false,
    ask: async () => null,
  }
  const messages = async () =>
    (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) =>
        decode(
          Schema.mutable(
            Schema.Record({
              key: Schema.String,
              value: Schema.Unknown,
            }),
          ),
          JSON.parse(line),
        ),
      )
  return {
    run,
    messages,
    controller,
  }
}
it('sends native steering with the exact active turn, client id and image inputs', async () => {
  const { run, messages } = await fixture('steer')
  let steer: AgentSteer | undefined
  run.onSteer = (value) => {
    steer = value
  }
  const done = codexAdapter.run(run)
  await vi.waitFor(() => expect(steer).toBeTypeOf('function'))
  await steer!({
    id: 'user-followup',
    prompt: 'Focus on tests',
    attachments: [
      {
        id: 'image',
        name: 'test.png',
        mime: 'image/png',
        size: 3,
        path: '/tmp/test.png',
        data: 'YWJj',
      },
    ],
  })
  await done
  expect(steer).toBeUndefined()
  const rows = await messages()
  expect(rows.filter((row) => row.method === 'turn/start')).toHaveLength(1)
  expect(rows.find((row) => row.method === 'turn/steer')?.params).toEqual({
    threadId: 'thread-1',
    expectedTurnId: 'turn-1',
    clientUserMessageId: 'user-followup',
    input: [
      {
        type: 'text',
        text: 'Focus on tests',
        text_elements: [],
      },
      {
        type: 'localImage',
        path: '/tmp/test.png',
      },
    ],
  })
  expect(rows.some((row) => row.method === 'turn/interrupt')).toBe(false)
})
it('propagates a native steering rejection without restarting the harness', async () => {
  const { run, messages } = await fixture('reject-steer')
  let steer: AgentSteer | undefined
  run.onSteer = (value) => {
    steer = value
  }
  const done = codexAdapter.run(run)
  await vi.waitFor(() => expect(steer).toBeTypeOf('function'))
  await expect(
    steer!({
      id: 'late',
      prompt: 'Too late',
    }),
  ).rejects.toThrow('no longer active')
  await done
  expect((await messages()).filter((row) => row.method === 'turn/start')).toHaveLength(1)
})
it('keeps streaming during an Astra question and returns the chosen/free-text answers with original IDs', async () => {
  const { run, messages } = await fixture('question')
  let answer: (value: { '0': string[] }) => void = () => {}
  run.ask = vi.fn<AgentRun['ask']>(async (prompt) => {
    expect(prompt.blocking).toBe(false)
    expect(prompt.questions[0]).toMatchObject({
      custom: true,
      question: 'How should we proceed?',
    })
    return new Promise((resolve) => {
      answer = resolve
    })
  })
  const done = codexAdapter.run(run)
  await vi.waitFor(() => expect(run.onText).toHaveBeenCalledWith('Continuing independent work'))
  answer({
    '0': ['My own approach'],
  })
  await done
  expect((await messages()).find((row) => row.id === 'question-1')?.result).toEqual({
    answers: {
      direction: {
        answers: ['My own approach'],
      },
    },
  })
})
it('clears a resolved question without inventing a default answer', async () => {
  const { run, messages } = await fixture('clear-question')
  run.ask = async (_prompt, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) resolve(null)
      else
        signal?.addEventListener('abort', () => resolve(null), {
          once: true,
        })
    })
  await codexAdapter.run(run)
  expect((await messages()).find((row) => row.id === 'question-1')?.result).toEqual({
    answers: {},
  })
})
it('recognizes Astra assistant-message forms once, including choices and free text', async () => {
  const { run } = await fixture('message-form')
  run.onQuestions = vi.fn<NonNullable<AgentRun['onQuestions']>>()
  await codexAdapter.run(run)
  expect(run.onQuestions).toHaveBeenCalledTimes(1)
  expect(run.onQuestions).toHaveBeenCalledWith(
    expect.objectContaining({
      blocking: false,
      questions: [
        expect.objectContaining({
          question: 'Which output style?',
          custom: true,
          options: [
            expect.objectContaining({
              label: 'Compact',
            }),
            expect.objectContaining({
              label: 'Detailed',
            }),
          ],
        }),
        expect.objectContaining({
          question: 'Any additional context?',
          custom: true,
          options: [],
        }),
      ],
    }),
  )
})
it('keeps child output and completion out of the parent conversation', async () => {
  const { run } = await fixture('child-events')
  run.onEvent = vi.fn<NonNullable<AgentRun['onEvent']>>()
  await codexAdapter.run(run)
  expect(run.onText).toHaveBeenCalledExactlyOnceWith('Parent output')
  expect(run.onEvent).toHaveBeenCalledWith(
    'turn/completed',
    expect.objectContaining({
      threadId: 'child',
    }),
  )
})
