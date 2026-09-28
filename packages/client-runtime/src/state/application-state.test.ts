import * as Registry from '@effect-atom/atom/Registry'
import { expect, it } from 'vitest'
import { applicationState } from './application-state.js'

it('publishes a stable view while retaining the latest authoritative value', () => {
  const registry = Registry.make()
  const state = applicationState({ revision: 1, seen: 10 }, (previous, next) =>
    previous?.revision === next.revision ? previous : next,
  )
  const unmount = registry.mount(state.view)
  try {
    const original = registry.get(state.view)
    registry.set(state.atom, { revision: 1, seen: 20 })
    expect(registry.get(state.atom).seen).toBe(20)
    expect(registry.get(state.view)).toBe(original)
    registry.set(state.atom, { revision: 2, seen: 30 })
    expect(registry.get(state.view)).toEqual({ revision: 2, seen: 30 })
  } finally {
    unmount()
    registry.dispose()
  }
})

it('stores functions as values and isolates separate application instances', () => {
  const first = Registry.make()
  const second = Registry.make()
  const callback = () => 'initial'
  const state = applicationState(callback)
  try {
    const replacement = () => 'updated'
    first.set(state.atom, replacement)
    expect(first.get(state.atom)).toBe(replacement)
    expect(second.get(state.atom)).toBe(callback)
  } finally {
    first.dispose()
    second.dispose()
  }
})
