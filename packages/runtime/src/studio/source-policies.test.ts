import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { openDatabase } from '../storage/database.js'
import { preserveSourcePolicies, SourcePolicies } from './source-policies.js'

it('keeps only persistent grants across restart and preserves revocation across restore', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-source-policies-'))
  const path = join(directory, 'runtime.sqlite')
  let db = openDatabase(path)
  const snapshot = openDatabase(':memory:')
  try {
    const extension = new SourcePolicies(db, 'extension')
    extension.save('weather', 'first', 'target', { access: 'session', autoLoad: true })
    extension.save('weather', 'second', 'target', { access: 'persistent', autoLoad: true })
    preserveSourcePolicies(snapshot, db)
    expect(extension.read('weather', 'first', 'target').access).toBe('session')
    db.close()
    db = openDatabase(path)
    const reopened = new SourcePolicies(db, 'extension')
    expect(reopened.read('weather', 'first', 'target').access).toBe('off')
    expect(reopened.read('weather', 'second', 'target')).toEqual({
      access: 'persistent',
      autoLoad: true,
    })
    expect(reopened.read('weather', 'second', 'replacement').access).toBe('off')
    expect(reopened.read('different-extension', 'second', 'target').access).toBe('off')
    expect(new SourcePolicies(db, 'dashboard').read('weather', 'second', 'target').access).toBe(
      'off',
    )
    reopened.clear('weather', 'second')
    preserveSourcePolicies(snapshot, db)
    expect(
      new SourcePolicies(snapshot, 'extension').read('weather', 'second', 'target').access,
    ).toBe('off')
  } finally {
    if (db.open) db.close()
    snapshot.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
