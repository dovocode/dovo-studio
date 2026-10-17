import { describe, expect, it } from 'vite-plus/test'
import type { DoPlanItem, RuntimeOverview } from '@dovo/protocol'
import { doThreadOwner, withoutDoItem } from './presentation'

function computer(id: string, address: string, runtimeId: string): RuntimeOverview {
  return {
    profile: { id, name: id, connection: { address, token: 'paired-device-token', runtimeId } },
    snapshot: null,
    connected: true,
    lastSeen: null,
    error: null,
    pulls: null,
    pullError: null,
  }
}
const phoneLocal = computer('phone-selected', 'http://one.local:51464', 'one')
const origin = computer('plan-home', 'http://two.local:51464', 'two')
const remote = computer('http://three.local:51464', 'http://three.local:51464', 'three')
const entries = [phoneLocal, origin, remote]

describe('Do thread routing', () => {
  it('opens local work on the plan home computer even when another computer is selected', () => {
    expect(doThreadOwner(entries, origin.profile.id, 'local')).toBe(origin)
  })

  it('resolves paired work through its saved identity or address', () => {
    expect(doThreadOwner(entries, origin.profile.id, remote.profile.id)).toBe(remote)
    expect(doThreadOwner(entries, origin.profile.id, 'three')).toBe(remote)
  })

  it('prefers canonical runtime identity over an earlier colliding legacy profile ID', () => {
    const collision = computer('three', 'http://unrelated.local:51464', 'unrelated-runtime')
    expect(doThreadOwner([collision, remote], origin.profile.id, 'three')).toBe(remote)
  })

  it('does not guess a thread owner when the target is not paired on this phone', () => {
    expect(doThreadOwner(entries, origin.profile.id, 'different-studio-profile')).toBeUndefined()
    expect(doThreadOwner(entries, 'forgotten-origin', 'local')).toBeUndefined()
  })
})

describe('removing planned work', () => {
  it('removes incoming dependencies without disturbing other assignments or mutating the draft', () => {
    const items: DoPlanItem[] = ['first', 'second', 'third'].map((id, index) => ({
      id,
      title: id,
      instructions: `Do ${id}`,
      dependsOn: index === 2 ? ['first', 'second'] : [],
      target: { runtimeId: 'local', repositoryId: 'project', execution: 'worktree' },
    }))
    const remaining = withoutDoItem(items, 'first')
    expect(remaining.map((item) => item.id)).toEqual(['second', 'third'])
    expect(remaining[1]?.dependsOn).toEqual(['second'])
    expect(remaining[1]?.target).toEqual(items[2]?.target)
    expect(items[2]?.dependsOn).toEqual(['first', 'second'])
  })
})
