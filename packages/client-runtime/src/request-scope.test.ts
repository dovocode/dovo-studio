import { expect, it } from 'vitest'
import { appendUniqueRows, clientScopeKey, RequestScope } from './request-scope.js'

it('rejects late page responses after navigation or unmount', async () => {
  const scope = new RequestScope()
  const firstPage = scope.begin()
  const detail = scope.begin()
  await Promise.resolve()
  expect(firstPage()).toBe(false)
  expect(detail()).toBe(true)
  scope.cancel()
  expect(detail()).toBe(false)
})

it('changes opaque client scope after an account replacement at the same host', () => {
  const first = { address: 'https://runtime.example', token: 'first-account' }
  const second = { ...first, token: 'second-account' }
  expect(clientScopeKey(first)).toBe(clientScopeKey(first))
  expect(clientScopeKey(second)).not.toBe(clientScopeKey(first))
  expect(clientScopeKey(undefined)).toBe(0)
})

it('merges overlapping pages once while retaining the newest values and row order', () => {
  expect(
    appendUniqueRows(
      [
        { id: '1', status: 'running' },
        { id: '2', status: 'queued' },
      ],
      [
        { id: '2', status: 'running' },
        { id: '3', status: 'queued' },
      ],
    ),
  ).toEqual([
    { id: '1', status: 'running' },
    { id: '2', status: 'running' },
    { id: '3', status: 'queued' },
  ])
})
