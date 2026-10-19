import { expect, it } from 'vite-plus/test'
import { resolveThreadRuntime } from './thread-navigation.js'

const old = { id: 'foreign-id', connection: { runtimeId: 'wrong-computer' } }
const paired = { id: 'new-local-profile', connection: { runtimeId: 'grandchild-computer' } }
const target = { runtimeId: 'foreign-id', runtimeIdentity: 'grandchild-computer' }

it('resumes using the newly paired identity, never a foreign profile ID or the active computer', () => {
  expect(resolveThreadRuntime(target, [old], [])).toBeUndefined()
  expect(resolveThreadRuntime(target, [old, paired], [])).toBe(paired)
  expect(resolveThreadRuntime({ ...target, runtimeId: null }, [paired], [])).toBe(paired)
})
it('supports legacy saved profiles through their cached identity and requires explicit choice without identity', () => {
  const legacy = { id: 'legacy', connection: {} }
  expect(
    resolveThreadRuntime(
      target,
      [legacy],
      [{ profile: legacy, snapshot: { runtimeId: target.runtimeIdentity } }],
    ),
  ).toBe(legacy)
  expect(resolveThreadRuntime({ runtimeId: 'missing' }, [legacy], [])).toBeUndefined()
  expect(resolveThreadRuntime({ runtimeId: legacy.id }, [legacy], [])).toBe(legacy)
})
it('does not trust a stale cached identity over the current pairing', () => {
  expect(
    resolveThreadRuntime(
      target,
      [old],
      [{ profile: old, snapshot: { runtimeId: target.runtimeIdentity } }],
    ),
  ).toBeUndefined()
})
