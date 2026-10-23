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

it('migrates saved relay settings and persists connection mode without losing custom credentials', () => {
  const db = new Database(':memory:')
  try {
    db.exec(
      'CREATE TABLE relay_settings(id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL,config TEXT)',
    )
    db.prepare('INSERT INTO relay_settings VALUES(1,?,?)').run(
      'custom',
      JSON.stringify({
        urls: ['turn:host:3478?transport=udp'],
        username: 'user',
        credential: 'secret',
      }),
    )
    const settings = new RuntimeRelaySettings(db)
    expect(settings.status().connectionMode).toBe('automatic')
    for (const mode of ['webrtc', 'lan'] as const) {
      settings.setConnectionMode(mode)
      expect(settings.issue()).toBeUndefined()
      const restarted = new RuntimeRelaySettings(db)
      expect(restarted.status()).toMatchObject({
        mode: 'custom',
        connectionMode: mode,
        configured: true,
      })
      restarted.set()
      expect(restarted.status().connectionMode).toBe(mode)
      restarted.set({ urls: ['turn:host'], username: 'user', credential: 'secret' })
    }
    settings.setConnectionMode('automatic')
    expect(settings.issue()?.iceServers[0]?.credential).toBe('secret')
  } finally {
    db.close()
  }
})
