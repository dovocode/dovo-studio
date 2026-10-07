import { expect, it, vi } from 'vite-plus/test'
import { openDatabase } from './database'
import { RuntimeDefaults } from './runtime-defaults'

it('shares cached reads across instances, invalidates saves and refreshes expired data', () => {
  const db = openDatabase(':memory:')
  const clock = vi.spyOn(Date, 'now')
  let now = 100000
  clock.mockImplementation(() => now)
  try {
    const first = new RuntimeDefaults(db)
    const second = new RuntimeDefaults(db)
    const prepare = vi.spyOn(db, 'prepare')
    const settings = first.get()
    const version = first.version()
    for (let index = 0; index < 100; index++) second.get()
    expect(prepare.mock.calls.filter(([sql]) => sql.startsWith('SELECT'))).toHaveLength(1)
    Reflect.set(settings.harness, 'model', 'local-mutation')
    expect(second.get().harness.model).not.toBe('local-mutation')
    now += 15000
    expect(second.version()).toBe(version)
    second.save({ ...second.get(), harness: { ...second.get().harness, model: 'saved' } })
    expect(first.get().harness.model).toBe('saved')
    expect(first.version()).not.toBe(version)
    const saved = first.get()
    const savedVersion = first.version()
    db.prepare('UPDATE documents SET value=? WHERE id=?').run(
      JSON.stringify({ ...saved, harness: { ...saved.harness, model: 'external' } }),
      'runtime-defaults',
    )
    expect(first.get().harness.model).toBe('saved')
    now += 15000
    expect(second.get().harness.model).toBe('external')
    expect(second.version()).not.toBe(savedVersion)
  } finally {
    vi.restoreAllMocks()
    db.close()
  }
})

it('does not retain uncommitted defaults after an outer transaction rolls back', () => {
  const db = openDatabase(':memory:')
  try {
    const defaults = new RuntimeDefaults(db)
    const original = defaults.get()
    expect(() =>
      db.transaction(() => {
        defaults.save({ ...original, harness: { ...original.harness, model: 'uncommitted' } })
        expect(defaults.get().harness.model).toBe('uncommitted')
        throw new Error('Rollback')
      })(),
    ).toThrow('Rollback')
    expect(new RuntimeDefaults(db).get()).toEqual(original)
  } finally {
    db.close()
  }
})
