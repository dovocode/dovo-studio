import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vite-plus/test'
import { ArtifactStore } from './store.js'

it('preserves hosted copies and grants across restart and cascades explicit deletion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-artifact-store-'))
  const path = join(directory, 'artifacts.sqlite')
  try {
    const published = (() => {
      const store = new ArtifactStore(path)
      try {
        const publication = store.publish('owner', {
          sourceId: randomUUID(),
          revision: 3,
          title: 'Saved report',
          format: 'html',
          content: '<h1>Report</h1>',
          files: [{ path: 'index.html', content: '<h1>Source report</h1>' }],
          entrypoint: 'index.html',
        })
        store.invite(publication.id, 'owner', 'recipient')
        const link = store.link(publication.id, 'owner', 3600)
        store.feedSetup(publication.id, 'owner', 'writer', Date.now() + 600_000, 60, { count: 3 })
        return { publication, link }
      } finally {
        store.db.close()
      }
    })()
    const restored = new ArtifactStore(path)
    try {
      const { publication, link } = published
      expect(restored.list('owner')).toEqual([publication])
      expect(restored.feedData(publication.id).data).toEqual({ count: 3 })
      expect(restored.get(publication.id).artifact.files?.[0].content).toBe(
        '<h1>Source report</h1>',
      )
      expect(restored.canView(publication.id)).toBe(false)
      expect(restored.canView(publication.id, 'recipient')).toBe(true)
      expect(restored.canView(publication.id, undefined, link.token)).toBe(true)
      restored.remove(publication.id, 'owner')
      expect(restored.db.prepare('SELECT * FROM invites').all()).toEqual([])
      expect(restored.db.prepare('SELECT * FROM links').all()).toEqual([])
      expect(restored.db.prepare('SELECT * FROM feeds').all()).toEqual([])
      expect(restored.list('owner')).toEqual([])
    } finally {
      restored.db.close()
    }
  } finally {
    rmSync(directory, { recursive: true })
  }
})

it('counts live data toward account and service quotas without losing the previous value', () => {
  const store = new ArtifactStore(':memory:', Date.now, 1024, 1500)
  try {
    const publish = (owner: string, content: string) =>
      store.publish(owner, {
        sourceId: randomUUID(),
        revision: 1,
        title: 'Report',
        format: 'html',
        content,
      })
    const first = publish('owner', '<p>Report</p>')
    store.feedSetup(first.id, 'owner', 'writer', Date.now() + 600_000, 60, 'x'.repeat(500))
    expect(() => publish('owner', 'y'.repeat(500))).toThrow(/quota/)
    expect(() =>
      store.feedSetup(first.id, 'owner', 'writer', Date.now() + 600_000, 60, 'x'.repeat(1000)),
    ).toThrow(/quota/)
    expect(store.feedData(first.id).data).toBe('x'.repeat(500))
    const second = publish('second', '<p>Report</p>')
    expect(() =>
      store.feedSetup(
        second.id,
        'second',
        'other-writer',
        Date.now() + 600_000,
        60,
        'x'.repeat(800),
      ),
    ).toThrow(/quota/)
  } finally {
    store.db.close()
  }
})
