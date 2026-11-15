import { expect, it } from 'vite-plus/test'
import { secureInputToolResult } from './secure-input-result.js'

it.each(['pending', 'running'] as const)('waits for completion while %s', (status) => {
  expect(secureInputToolResult({ id: 'request', status })).toMatchObject({
    id: 'request',
    status,
    deliveryCompleted: false,
    nextAction: 'wait_for_completion_message',
  })
  expect(secureInputToolResult({ id: 'request', status }).guidance).toContain(
    'Do not discover, prepare or start delivery-dependent work until completion.',
  )
})
it.each(['failed', 'cancelled', 'expired'] as const)(
  'keeps dependent work blocked after %s',
  (status) => {
    expect(secureInputToolResult({ id: 'request', status })).toMatchObject({
      id: 'request',
      status,
      deliveryCompleted: false,
      nextAction: 'report_incomplete_delivery',
    })
  },
)
it('reports completion without giving new permission or forwarding extra fields', () => {
  expect(
    secureInputToolResult({ id: 'request', status: 'completed', unexpected: 'discard' }),
  ).toEqual({
    id: 'request',
    status: 'completed',
    deliveryCompleted: true,
  })
})
it('rejects malformed status metadata', () => {
  expect(() => secureInputToolResult({ id: 'request', status: 'delivered' })).toThrow('status')
  expect(() => secureInputToolResult({ status: 'pending' })).toThrow('id')
})
