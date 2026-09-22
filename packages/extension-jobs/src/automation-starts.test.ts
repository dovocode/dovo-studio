import { expect, it } from 'vite-plus/test'
import {
  acknowledgeAutomationStart,
  automationStartRequest,
  pendingAutomationStart,
} from './automation-starts'

it('retains uncertain starts across reopening details without mixing hosts or credentials', () => {
  const connection = { address: 'http://one:51464', token: 'original-token' }
  const request = automationStartRequest(connection, 'same-flow')
  expect(automationStartRequest({ ...connection }, 'same-flow')).toBe(request)
  expect(
    pendingAutomationStart({ ...connection, address: 'http://two:51464' }, 'same-flow'),
  ).toBeUndefined()
  expect(pendingAutomationStart({ ...connection, token: 'new-token' }, 'same-flow')).toBeUndefined()
  acknowledgeAutomationStart(connection, 'same-flow', 'old-response')
  expect(pendingAutomationStart(connection, 'same-flow')).toBe(request)
  acknowledgeAutomationStart(connection, 'same-flow', request)
  expect(pendingAutomationStart(connection, 'same-flow')).toBeUndefined()
  expect(automationStartRequest(connection, 'same-flow')).not.toBe(request)
})
