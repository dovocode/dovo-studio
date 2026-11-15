import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spacedGate, startProviderProxy } from './benchmark-provider-proxy.mjs'

await test('all callers share spacing and never exceed 18 starts in a rolling minute', async () => {
  let time = 0
  const gate = spacedGate({
    now: () => time,
    wait: async (ms) => {
      time += ms
    },
  })
  const starts = []
  await Promise.all(
    Array.from({ length: 65 }, async () => {
      await gate()
      starts.push(time)
    }),
  )
  for (const start of starts)
    assert.ok(starts.filter((t) => t >= start && t < start + 60000).length <= 18)
  const aborted = AbortSignal.abort()
  await assert.rejects(gate(aborted))
  await gate()
})

await test('real HTTP forwards bodies, authorization, SSE and provider failures without logging secrets', async () => {
  const received = []
  const upstream = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    received.push({ body, authorization: request.headers.authorization })
    response.writeHead(request.url.includes('fail') ? 429 : 200, {
      'content-type': 'text/event-stream',
    })
    response.write('data: first\n\n')
    response.end('data: [DONE]\n\n')
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const proxy = await startProviderProxy({
    upstream: `http://127.0.0.1:${upstream.address().port}/v1`,
    intervalMs: 5,
  })
  try {
    const replies = await Promise.all(
      ['chat/completions', 'fail'].map((path) =>
        fetch(proxy.baseURL + '/' + path, {
          method: 'POST',
          headers: { Authorization: 'Bearer test-secret' },
          body: 'private prompt',
        }),
      ),
    )
    assert.deepEqual(
      replies.map((r) => r.status),
      [200, 429],
    )
    for (const reply of replies) assert.equal(await reply.text(), 'data: first\n\ndata: [DONE]\n\n')
    assert.deepEqual(
      received,
      Array.from({ length: 2 }, () => ({
        body: 'private prompt',
        authorization: 'Bearer test-secret',
      })),
    )
    assert.equal(proxy.records.length, 2)
    assert.doesNotMatch(JSON.stringify(proxy.records), /test-secret|private prompt/)
  } finally {
    await proxy.close()
    await new Promise((resolve) => upstream.close(resolve))
  }
})

await test('client cancellation can flag a completed SSE result with HTTP 200', async () => {
  let remoteResponse
  const upstream = createServer((_request, response) => {
    remoteResponse = response
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    // A completed model result does not require the upstream to close its stream.
    response.write('data: [DONE]\n\n')
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const proxy = await startProviderProxy({
    upstream: `http://127.0.0.1:${upstream.address().port}/v1`,
    intervalMs: 0,
  })
  try {
    const response = await fetch(proxy.baseURL + '/chat/completions', {
      signal: AbortSignal.timeout(5000),
    })
    const reader = response.body.getReader()
    const result = await reader.read()
    assert.equal(new TextDecoder().decode(result.value), 'data: [DONE]\n\n')
    assert.ok(remoteResponse)
    const closed = once(remoteResponse, 'close', { signal: AbortSignal.timeout(3000) })
    await reader.cancel()
    await closed
    assert.equal(proxy.records[0].status, 200)
    assert.equal(proxy.records[0].failed, true)
  } finally {
    await proxy.close()
    await new Promise((resolve) => upstream.close(resolve))
  }
})
