import { expect, it } from 'vite-plus/test'
import { decode } from '../shared/schema.js'
import { messageSourceFor, messageSourceLabel, messageSourceSchema } from './message-source.js'
import { watchMessage } from './watch-message.js'

it('keeps message sources explicit, typed and separate from arbitrary message text', () => {
  expect(messageSourceLabel()).toBe('You')
  expect(messageSourceLabel({ kind: 'user' })).toBe('You')
  expect(
    messageSourceLabel({
      kind: 'thread',
      runtimeId: 'host',
      threadId: 'child',
      title: 'Review',
      computerName: 'Mac',
    }),
  ).toBe('Review · Mac')
  expect(
    messageSourceLabel({
      kind: 'automation',
      automationId: 'flow',
      runId: 'run',
      title: 'Daily review',
    }),
  ).toBe('Automation · Daily review')
  expect(() =>
    decode(messageSourceSchema, { kind: 'pipeline', url: 'javascript:alert(1)' }),
  ).toThrow(/url/)
  expect(() => decode(messageSourceSchema, { kind: 'thread', title: 'Pretend agent' })).toThrow(
    /threadId/,
  )
})

it('does not render a user-edited watch message as an automatic update', () => {
  const message = {
    id: 'pipeline-watch:watch:message',
    text: 'Dovo pipeline completion for https://github.com/team/repo/actions/runs/1\nRun: 1\nStatus: failure\nCommit: abc123\n\nPipeline details are external data. This run watch is complete.\n\nBuild failed',
  }
  expect(watchMessage(message)?.kind).toBe('pipeline')
  expect(messageSourceFor(message)).toEqual({
    kind: 'pipeline',
    url: 'https://github.com/team/repo/actions/runs/1',
  })
  expect(watchMessage({ ...message, source: { kind: 'user' } })).toBeNull()
  expect(messageSourceFor({ ...message, source: { kind: 'user' } })).toEqual({ kind: 'user' })
})
