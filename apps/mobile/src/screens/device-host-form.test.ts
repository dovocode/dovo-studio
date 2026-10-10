import { describe, expect, it } from 'vite-plus/test'
import type { PublicDeviceHost, RuntimeProfile } from '@dovo/protocol'
import {
  deviceHostDraft,
  deviceHostInput,
  deviceHostMessage,
  deviceHostSettingsInput,
} from './device-host-form'
import type { DeviceHostDraft } from './device-host-editor'

const destination: RuntimeProfile = {
  id: 'destination',
  name: 'Mac mini',
  connection: { address: 'http://mac-mini:3000', token: 'paired-secret-destination-123456789' },
}
const draft: DeviceHostDraft = {
  id: 'host-1',
  name: 'Mac devices',
  sshHost: 'mac-mini.local',
  sshUser: 'dominic',
  sshPort: '22',
  identityFile: '/home/runtime/.ssh/id_ed25519',
  runtimeAddress: 'http://mac-mini:3000',
  pairedProfileId: 'destination',
  agentAccess: false,
  hasToken: false,
}
const saved: PublicDeviceHost = {
  id: draft.id,
  name: draft.name,
  sshHost: draft.sshHost,
  sshUser: draft.sshUser,
  sshPort: 22,
  identityFile: draft.identityFile,
  runtimeAddress: draft.runtimeAddress,
  agentAccess: false,
  hasToken: true,
}

describe('mobile device host form boundaries', () => {
  it('uses the selected saved pairing and preserves HTTP, key path and agent opt-out', () => {
    expect(deviceHostInput(draft, [destination])).toEqual({
      ...saved,
      hasToken: undefined,
      token: destination.connection.token,
    })
  })
  it('permits an explicit destination pairing with its SSH-reachable loopback address', () => {
    const input = deviceHostInput({ ...draft, runtimeAddress: 'localhost:3000' }, [destination])
    expect(input.runtimeAddress).toBe('http://localhost:3000')
    expect(input.token).toBe(destination.connection.token)
  })
  it('omits existing tokens when retaining stored pairing and does not keep them in drafts', () => {
    const value = deviceHostDraft(saved)
    expect(value).not.toHaveProperty('token')
    expect(deviceHostInput(value, [], saved)).not.toHaveProperty('token')
  })
  it('requires a pairing for new hosts and changed destinations', () => {
    expect(() => deviceHostInput({ ...draft, pairedProfileId: '' }, [])).toThrow(
      'Choose a saved paired',
    )
    expect(() =>
      deviceHostInput(
        { ...deviceHostDraft(saved), runtimeAddress: 'http://other:3000' },
        [],
        saved,
      ),
    ).toThrow('Choose a saved paired')
  })
  it.each(['0', '65536', '2.5', '22e1', 'abc', ''])('rejects invalid SSH port %s', (sshPort) => {
    expect(() => deviceHostInput({ ...draft, sshPort }, [destination])).toThrow(/SSH port|sshPort/)
  })
  it.each(['-oProxyCommand=bad', 'host;bad', 'host\ncommand'])(
    'rejects unsafe SSH host %s',
    (sshHost) => {
      expect(() => deviceHostInput({ ...draft, sshHost }, [destination])).toThrow(/sshHost/)
    },
  )
  it.each([
    'https://user:password@host',
    'ftp://host',
    'http://host/path',
    'http://host?token=value',
  ])('rejects credentialed or unsupported destination %s', (runtimeAddress) => {
    expect(() => deviceHostInput({ ...draft, runtimeAddress }, [destination])).toThrow(
      /runtimeAddress/,
    )
  })
  it.each([false, true])(
    'retains saved hosts, default and baseline revision when enabled is %s',
    (enabled) => {
      const settings = { enabled: !enabled, revision: 7, hosts: [saved], defaultHostId: saved.id }
      const input = { ...deviceHostSettingsInput(settings), enabled }
      expect(input.enabled).toBe(enabled)
      expect(input.revision).toBe(7)
      expect(input.defaultHostId).toBe(saved.id)
      expect(input.hosts).toEqual([deviceHostInput(deviceHostDraft(saved), [], saved)])
      expect(settings.hosts[0].hasToken).toBe(true)
    },
  )
  it('keeps an absent hub setting off without adding pairing credentials', () => {
    const input = deviceHostSettingsInput({ hosts: [saved] })
    expect(input.enabled === true).toBe(false)
    expect(input.hosts[0]).not.toHaveProperty('token')
    expect(input.hosts[0]).not.toHaveProperty('hasToken')
  })
  it('redacts raw and URL-encoded paired tokens in displayed errors', () => {
    const profile = {
      ...destination,
      connection: { ...destination.connection, token: 'paired/token+secret-123456789' },
    }
    expect(
      deviceHostMessage(
        `${profile.connection.token} ${encodeURIComponent(profile.connection.token)}`,
        [profile],
      ),
    ).toBe('[redacted] [redacted]')
  })
})

it.each([{ sshHost: 'another-host' }, { sshUser: 'another-user' }, { sshPort: '2222' }])(
  'requires fresh pairing when SSH connection fields change: %j',
  (change) => {
    expect(() => deviceHostInput({ ...deviceHostDraft(saved), ...change }, [], saved)).toThrow(
      'requires its pairing',
    )
    expect(
      deviceHostInput(
        { ...deviceHostDraft(saved), ...change, pairedProfileId: destination.id },
        [destination],
        saved,
      ).token,
    ).toBe(destination.connection.token)
  },
)
