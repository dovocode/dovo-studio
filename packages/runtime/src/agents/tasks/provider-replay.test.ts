import { writeFile, readFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Schema } from 'effect'
import { decode, mutableStruct } from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration'
vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})
async function replay(failInterrupt = false) {
  let stream: ServerResponse | undefined
  const servers = new Set<string>()
  const prompts: string[] = [],
    operations: string[] = []
  const emit = (type: string, data: unknown) =>
    stream?.write(
      `data: ${JSON.stringify({ id: `${type}:${Date.now()}`, created: Date.now(), type, data })}\n\n`,
    )
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    operations.push(path)
    if (path === '/api/event') {
      stream = response
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.flushHeaders()
      response.write(`data: ${JSON.stringify({ type: 'server.connected' })}\n\n`)
      return
    }
    response.setHeader('Content-Type', 'application/json')
    if (path.startsWith('/api/experimental/mcp/')) {
      const name = decodeURIComponent(path.split('/').at(-1) ?? '')
      if (request.method === 'PUT') servers.add(name)
      if (request.method === 'DELETE') servers.delete(name)
      response.statusCode = 204
      return response.end()
    }
    if (path === '/api/mcp')
      return response.end(
        JSON.stringify({
          data: [...servers].map((name) => ({ name, status: { status: 'connected' } })),
        }),
      )
    if (path === '/api/info') return response.end(JSON.stringify({ version: '2.0.19' }))
    if (path === '/api/session/active') return response.end(JSON.stringify({ data: {} }))
    if (path === '/api/session' && request.method === 'POST')
      return response.end(JSON.stringify({ data: { id: 'session' } }))
    if (path.endsWith('/prompt')) {
      let raw = ''
      for await (const chunk of request) raw += String(chunk)
      const input = decode(mutableStruct({ text: Schema.String }), JSON.parse(raw))
      prompts.push(input.text)
      response.end(JSON.stringify({ id: `inbox-${prompts.length}`, sessionID: 'session' }))
      // A previous execution's late terminal must never finish this attempt.
      emit('session.execution.succeeded', { sessionID: 'session' })
      emit('session.text.delta', {
        sessionID: 'session',
        assistantMessageID: 'retired',
        ordinal: 0,
        delta: 'STALE',
      })
      emit('session.execution.started', { sessionID: 'session' })
      return
    }
    if (path.endsWith('/interrupt')) {
      if (failInterrupt) {
        response.statusCode = 500
        return response.end(JSON.stringify({ error: 'Provider interrupt failed' }))
      }
      return response.end(JSON.stringify({ interrupted: true }))
    }
    if (
      path.endsWith('/wait') ||
      path.endsWith('/model') ||
      ['PATCH', 'PUT'].includes(request.method ?? '')
    ) {
      response.statusCode = 204
      return response.end()
    }
    response.end(
      JSON.stringify({
        data: {
          id: 'session',
          cost: 0,
          tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        },
      }),
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No transport address')
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  })
  const f = await fixture()
  cleanups.push(f.cleanup)
  const options = {
    port: 0,
    databasePath: join(f.directory, '.git', 'replay.sqlite'),
    ownerToken: 'synthetic-replay-owner-token-long-enough',
  }
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  runtime.services.store.update(() => ({
    ...f.workspace,
    agents: f.workspace.agents.map((agent) => ({
      ...agent,
      provider: 'opencode',
      endpoint: `http://127.0.0.1:${address.port}`,
      model: 'openai/test',
    })),
  }))
  const task = runtime.services.tasks.create({
    title: 'Replay',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original request',
  })
  const text = (delta: string, sessionID = 'session') =>
    emit('session.text.delta', { sessionID, assistantMessageID: 'assistant', ordinal: 0, delta })
  const finish = () => emit('session.execution.succeeded', { sessionID: 'session' })
  return { runtime, options, task, prompts, operations, emit, text, finish }
}
it('replays raw transport into the real queue, SQLite, activity and checkpoint pipeline', async () => {
  const r = await replay(),
    s = r.runtime.services
  const execution = await s.tasks.start(r.task.id)
  await waitForRuntime(() => {
    if (s.store.task(r.task.id).status === 'failed')
      throw new Error(s.store.task(r.task.id).error + ' ' + JSON.stringify(r.operations))
    expect(r.prompts).toHaveLength(1)
  })
  r.emit('session.execution.succeeded', { sessionID: 'child' })
  r.text('CHILD', 'child')
  await s.tasks.send(r.task.id, 'next', 'Queued instruction')
  expect(s.store.task(r.task.id).status).toBe('running')
  expect(r.prompts).toHaveLength(1)
  r.text('First reply')
  r.finish()
  await waitForRuntime(() => expect(r.prompts).toHaveLength(2))
  expect(r.prompts[1]).toContain('Queued instruction')
  r.text('Second reply')
  r.finish()
  await execution.done
  const task = s.store.task(r.task.id)
  expect(task.status).toBe('review')
  expect(
    task.messages.filter((message) => message.role === 'assistant').map((message) => message.text),
  ).toEqual(['First reply', 'Second reply'])
  expect(task.turns).toHaveLength(2)
  expect(task.turns?.every((turn) => !!turn.checkpoint?.after)).toBe(true)
  expect(task.activeRunId).toBeUndefined()
  expect(
    s.store.providerActions
      .list(task.id)
      .filter((action) => action.kind === 'start')
      .map((action) => action.state),
  ).toEqual(['completed', 'completed'])
})
it('rejects retired run controls after fallback steering and waits for real interrupt cleanup', async () => {
  const r = await replay(),
    s = r.runtime.services
  const first = await s.tasks.start(r.task.id)
  const rejected = first.done.catch((cause: unknown) => cause)
  await waitForRuntime(() => {
    if (s.store.task(r.task.id).status === 'failed')
      throw new Error(s.store.task(r.task.id).error + ' ' + JSON.stringify(r.operations))
    expect(r.prompts).toHaveLength(1)
  })
  const token = s.store.task(r.task.id).activeRunId
  const runId = s.store.task(r.task.id).turns?.[0]?.runId
  if (!token) throw new Error('Missing attempt token')
  await runClientEffect(s.tasks.steerEffect(r.task.id, 'steer', 'Change direction', [], token))
  await rejected
  await waitForRuntime(() => expect(r.prompts).toHaveLength(2))
  const current = s.store.task(r.task.id)
  expect(current.activeRunId).not.toBe(token)
  expect(current.turns?.[1]?.runId).toBe(runId)
  expect(current.turns?.[1]?.id).not.toBe(current.turns?.[0]?.id)
  expect(r.operations.some((path) => path.endsWith('/interrupt'))).toBe(true)
  expect(r.operations.some((path) => path.endsWith('/wait'))).toBe(true)
  for (const [path, payload] of [
    ['/api/tasks/cancel', { id: r.task.id, runId: token }],
    ['/api/tasks/cancel', { id: r.task.id }],
    [
      '/api/tasks/steer',
      { id: r.task.id, messageId: 'http-stale', text: 'Old instruction', runId: token },
    ],
  ] as const) {
    const response = await fetch(`http://127.0.0.1:${r.runtime.port}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${r.options.ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    expect(response.status).toBe(409)
  }
  expect(s.store.task(r.task.id).activeRunId).toBe(current.activeRunId)
  expect(() => s.tasks.cancel(r.task.id, token)).toThrow('This run ended')
  await expect(
    runClientEffect(s.tasks.steerEffect(r.task.id, 'stale', 'Old instruction', [], token)),
  ).rejects.toThrow('This run ended')
  expect(s.store.task(r.task.id).queue?.some((message) => message.id === 'stale')).toBe(false)
  r.text('Updated reply')
  r.finish()
  await waitForRuntime(() => expect(s.store.task(r.task.id).status).toBe('review'))
})
it('keeps a failed provider interrupt uncertain and does not snapshot a still-running execution', async () => {
  const r = await replay(true),
    s = r.runtime.services
  const execution = await s.tasks.start(r.task.id)
  const done = execution.done.catch((cause: unknown) => cause)
  await waitForRuntime(() => expect(r.prompts).toHaveLength(1))
  const attemptId = s.store.task(r.task.id).activeRunId
  if (!attemptId) throw new Error('Missing attempt')
  s.tasks.cancel(r.task.id, attemptId)
  await done
  expect(s.store.providerActions.state(`interrupt:${attemptId}`)).toBe('uncertain')
  expect(s.store.task(r.task.id).turns?.[0]?.checkpoint?.after).toBeUndefined()
  expect(s.store.task(r.task.id).turns?.[0]?.checkpoint?.error).toContain(
    'shutdown was not confirmed',
  )
})
it('persists acceptance across restart without resending a lost acknowledgement', async () => {
  const r = await replay(),
    s = r.runtime.services
  const first = await s.tasks.start(r.task.id)
  const done = first.done.catch((cause: unknown) => cause)
  await waitForRuntime(() => {
    if (s.store.task(r.task.id).status === 'failed')
      throw new Error(s.store.task(r.task.id).error + ' ' + JSON.stringify(r.operations))
    expect(r.prompts).toHaveLength(1)
  })
  r.text('Accepted')
  await waitForRuntime(() => expect(s.store.task(r.task.id).runAttempt?.promptAccepted).toBe(true))
  await s.tasks.send(r.task.id, 'follow-up', 'Keep this queued')
  await waitForRuntime(() =>
    expect(s.store.task(r.task.id).messages.some((message) => message.text === 'Accepted')).toBe(
      true,
    ),
  )
  await r.runtime.close()
  await done
  const restarted = await startRuntime(r.options)
  cleanups.push(restarted.close)
  await restarted.services.tasks.send(r.task.id, 'follow-up', 'Keep this queued')
  expect(restarted.services.store.task(r.task.id).queue?.map((message) => message.id)).toEqual([
    'follow-up',
  ])
  expect(r.prompts).toHaveLength(1)
  expect(
    restarted.services.store
      .task(r.task.id)
      .messages.some((message) => message.text === 'Accepted'),
  ).toBe(true)
})

async function codexReplay(mode: 'steer' | 'question') {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const executable = join(f.directory, '.git', 'codex-replay')
  const log = join(f.directory, '.git', 'rpc.jsonl')
  await writeFile(
    executable,
    `#!${process.execPath}
const fs = require('node:fs');
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
const finish = () => {
 send({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',delta:'Root reply'}});
 send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});
};
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);
 fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(m)+'\\n');
 if(m.id==='question-1') { finish(); return; }
 if(m.id===undefined) return;
 if(m.method==='initialize') send({id:m.id,result:{userAgent:'codex/0.155.1'}});
 else if(m.method==='thread/start') send({id:m.id,result:{thread:{id:'thread-1'}}});
 else if(m.method==='turn/start') {
   // Root events can arrive in the same transport batch as turn admission.
   send({id:m.id,result:{turn:{id:'turn-1',status:'inProgress'}}});
   send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'retired',status:'completed'}}});
   send({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'retired',delta:'STALE'}});
   send({method:'turn/completed',params:{threadId:'child',turn:{id:'child-turn',status:'completed'}}});
   send({method:'item/agentMessage/delta',params:{threadId:'child',turnId:'child-turn',delta:'CHILD'}});
   if(${JSON.stringify(mode)}==='question') send({id:'question-1',method:'item/tool/requestUserInput',params:{threadId:'thread-1',turnId:'turn-1',itemId:'question-item',isBlocking:true,questions:[{id:'direction',header:'Direction',question:'Choose the direction',isOther:true,isSecret:false,options:[{label:'Small change',description:'Keep it focused'}]}]}});
 } else if(m.method==='turn/steer') {
   send({id:m.id,result:{turnId:'turn-1'}});
   setTimeout(finish, 25);
 } else send({id:m.id,result:{}});
});`,
    { mode: 0o700 },
  )
  const runtime = await startRuntime({
    databasePath: ':memory:',
    port: 0,
    ownerToken: 'synthetic-codex-replay-owner-token',
  })
  cleanups.push(runtime.close)
  runtime.services.store.update(() => ({
    ...f.workspace,
    agents: f.workspace.agents.map((agent) => ({
      ...agent,
      endpoint: executable,
      model: 'gpt-6-astra',
    })),
  }))
  const task = runtime.services.tasks.create({
    title: 'Codex replay',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original',
  })
  const rows = async () =>
    (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) =>
        decode(Schema.Record({ key: Schema.String, value: Schema.Unknown }), JSON.parse(line)),
      )
  return { runtime, task, rows }
}
it('replays native Codex steering with exact provider turn correlation into the real task pipeline', async () => {
  const r = await codexReplay('steer'),
    s = r.runtime.services
  const execution = await s.tasks.start(r.task.id)
  await waitForRuntime(async () =>
    expect((await r.rows()).some((row) => row.method === 'turn/start')).toBe(true),
  )
  // A logged turn/start request precedes provider admission and native steering registration.
  await waitForRuntime(() => expect(s.store.task(r.task.id).runAttempt?.promptAccepted).toBe(true))
  const token = s.store.task(r.task.id).activeRunId
  expect(s.store.task(r.task.id).status).toBe('running')
  await runClientEffect(s.tasks.steerEffect(r.task.id, 'native-steer', 'Focus on tests', [], token))
  await execution.done
  const task = s.store.task(r.task.id)
  expect(task.turns).toHaveLength(1)
  expect(task.messages.some((message) => message.text === 'Root reply')).toBe(true)
  expect(
    task.messages.some(
      (message) => message.text.includes('STALE') || message.text.includes('CHILD'),
    ),
  ).toBe(false)
  expect(task.messages.filter((message) => message.id === 'native-steer')).toHaveLength(1)
  expect((await r.rows()).find((row) => row.method === 'turn/steer')?.params).toMatchObject({
    expectedTurnId: 'turn-1',
    clientUserMessageId: 'native-steer',
  })
  expect(
    s.store.providerActions.list(task.id).find((action) => action.kind === 'steer')?.state,
  ).toBe('completed')
})
it('replays a native Codex input response with durable acceptance and provider completion', async () => {
  const r = await codexReplay('question'),
    s = r.runtime.services
  const execution = await s.tasks.start(r.task.id)
  await waitForRuntime(() => expect(s.questions.list()).toHaveLength(1))
  const question = s.questions.list()[0]!
  s.questions.respond(question.id, { [question.prompt.questions[0]!.id]: ['Small change'] })
  await execution.done
  expect(s.store.questionResponse(question.id)).toBeTruthy()
  expect(
    s.store.providerActions.list(r.task.id).find((action) => action.kind === 'answer')?.state,
  ).toBe('completed')
  expect((await r.rows()).find((row) => row.id === 'question-1')?.result).toEqual({
    answers: { direction: { answers: ['Small change'] } },
  })
  expect(s.store.task(r.task.id).status).toBe('review')
  expect(s.store.task(r.task.id).turns?.[0]?.checkpoint?.after).toBeTruthy()
})
