import { expect, it } from 'vite-plus/test'
import Database from 'better-sqlite3'
import { RuntimeRelaySettings } from './relay-settings.js'

it('preserves manual overrides, hides credentials and fails closed when the organization lease expires', () => {
  const db = new Database(':memory:')
  try {
    const settings = new RuntimeRelaySettings(db)
    const now = Date.now()
    const organization = {
      name: 'Company',
      lease: now + 12_000,
      relay: {
        provider: 'custom' as const,
        expiresAt: now + 300_000,
        iceServers: [
          {
            urls: ['turn:org.example.com:3478?transport=udp'],
            username: 'org-user',
            credential: 'org-password',
          },
        ],
      },
    }
    settings.setOrganization(organization)
    expect(settings.status().mode).toBe('organization')
    expect(settings.issue(now)).toEqual(organization.relay)
    expect(settings.issue(now + 12_001)).toBeUndefined()
    settings.set({ urls: ['turn:10.0.0.1'], username: 'own-user', credential: 'own-password' })
    expect(JSON.stringify(settings.status())).not.toMatch(/own-user|own-password|org-password/)
    expect(settings.issue(now)?.iceServers[0]?.urls).toEqual(['turn:10.0.0.1:3478?transport=udp'])
    const restarted = new RuntimeRelaySettings(db)
    expect(restarted.status().mode).toBe('custom')
    expect(restarted.issue(now)?.iceServers[0]?.credential).toBe('own-password')
    settings.set()
    expect(settings.status().mode).toBe('organization')
    settings.setOrganization(undefined)
    expect(settings.issue(now)).toBeUndefined()
  } finally {
    db.close()
  }
})
