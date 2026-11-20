import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { startRuntime } from '../index'

const directories: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('recovers a phone limit save after a lost receipt without undoing a newer desktop save', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-preference-replay-'))
  directories.push(directory)
  vi.stubEnv('DOVO_SETTINGS_PATH', join(directory, 'settings.json'))
  const databasePath = join(directory, 'runtime.sqlite')
  const ownerToken = 'preference-replay-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath, ownerToken, port: 0 })
  const fault = new Database(databasePath)
  try {
    const phone = 'preference-replay-phone-token-at-least-32-characters'
    const desktop = 'preference-replay-desktop-token-at-least-32-chars'
    runtime.services.devices.add('Phone', phone)
    runtime.services.devices.add('Desktop', desktop)
    const save = (token: string, mutationId: string, input: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/runtime/preferences/save`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-dovo-mutation-id': mutationId,
        },
        body: JSON.stringify(input),
      })
    // The settings commit, then the receipt write fails.
    fault.exec(
      `CREATE TRIGGER lose_receipt BEFORE UPDATE OF result ON mutation_receipts WHEN NEW.result IS NOT NULL BEGIN SELECT RAISE(ABORT, 'receipt disk failure'); END`,
    )
    expect((await save(phone, 'phone-limit', { unattendedSpendLimitUsd: 100 })).ok).toBe(false)
    expect(runtime.services.preferences.get().unattendedSpendLimitUsd).toBe(100)
    fault.exec('DROP TRIGGER lose_receipt')

    const newer = await save(desktop, 'desktop-limit', { unattendedSpendLimitUsd: 10 })
    expect(newer.status).toBe(200)
    expect(runtime.services.preferences.get().unattendedSpendLimitUsd).toBe(10)

    // The phone journal retries the uncertain save. It recovers instead of writing 100 again.
    const retry = await save(phone, 'phone-limit', { unattendedSpendLimitUsd: 100 })
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ unattendedSpendLimitUsd: 10 })
    expect(runtime.services.preferences.get().unattendedSpendLimitUsd).toBe(10)
    // The receipt now holds the recovered outcome.
    expect(
      await (await save(phone, 'phone-limit', { unattendedSpendLimitUsd: 100 })).json(),
    ).toMatchObject({ unattendedSpendLimitUsd: 10 })
    expect(runtime.services.preferences.get().unattendedSpendLimitUsd).toBe(10)
  } finally {
    fault.close()
    await runtime.close()
  }
})

it('refuses to replay an unfinished save from an older runtime over a newer limit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-preference-upgrade-'))
  directories.push(directory)
  const settingsPath = join(directory, 'settings.json')
  vi.stubEnv('DOVO_SETTINGS_PATH', settingsPath)
  const databasePath = join(directory, 'runtime.sqlite')
  const ownerToken = 'preference-upgrade-owner-token-at-least-32-characters'
  const phone = 'preference-upgrade-phone-token-at-least-32-characters'
  const path = '/api/runtime/preferences/save'
  const before = await startRuntime({ databasePath, ownerToken, port: 0 })
  const phoneId = before.services.devices.add('Phone', phone)
  await before.close()

  // Rebuild the state an older runtime leaves: the phone save of 100 committed, its receipt
  // stayed unfinished, a desktop then saved 10, and no save records or attempts exist.
  const legacy = new Database(databasePath)
  const receipt = (id: string, input: unknown) =>
    legacy.prepare('INSERT INTO mutation_receipts VALUES (?, ?, ?, NULL)').run(
      phoneId,
      id,
      createHash('sha256')
        .update(JSON.stringify({ method: 'POST', path, input }))
        .digest('hex'),
    )
  try {
    legacy.exec('DROP TABLE IF EXISTS runtime_preference_save_attempts')
    receipt('legacy-limit', { unattendedSpendLimitUsd: 100 })
    receipt('legacy-same', { unattendedSpendLimitUsd: 10 })
  } finally {
    legacy.close()
  }
  writeFileSync(settingsPath, JSON.stringify({ runtime: { unattendedSpendLimitUsd: 10 } }))

  const runtime = await startRuntime({ databasePath, ownerToken, port: 0 })
  const inspect = new Database(databasePath, { readonly: true })
  try {
    const save = (mutationId: string, input: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${phone}`,
          'Content-Type': 'application/json',
          'x-dovo-mutation-id': mutationId,
        },
        body: JSON.stringify(input),
      })
    const attempts = () =>
      inspect.prepare('SELECT id, base_revision FROM runtime_preference_save_attempts').all()
    const replay = await save('legacy-limit', { unattendedSpendLimitUsd: 100 })
    expect(replay.status).toBe(409)
    expect(await replay.json()).toMatchObject({
      error: expect.stringContaining('cannot confirm'),
    })
    expect(runtime.services.preferences.get().unattendedSpendLimitUsd).toBe(10)
    // The upgrade marked both unfinished receipts with an unknown base.
    expect(attempts()).toEqual([
      { id: 'legacy-limit', base_revision: null },
      { id: 'legacy-same', base_revision: null },
    ])
    // A legacy save that matches the current value is already in effect.
    const same = await save('legacy-same', { unattendedSpendLimitUsd: 10 })
    expect(same.status).toBe(200)
    expect(runtime.services.preferences.get().unattendedSpendLimitUsd).toBe(10)
    // Both receipts are now settled, so the next save prunes their attempts. It keeps only
    // its own attempt, which the following save prunes once its receipt is settled.
    expect((await save('new-limit', { unattendedSpendLimitUsd: 25 })).status).toBe(200)
    expect(attempts()).toEqual([{ id: 'new-limit', base_revision: 0 }])
    expect((await save('later-limit', { unattendedSpendLimitUsd: 30 })).status).toBe(200)
    expect(attempts()).toEqual([{ id: 'later-limit', base_revision: 1 }])
    expect(runtime.services.preferences.get().unattendedSpendLimitUsd).toBe(30)
  } finally {
    inspect.close()
    await runtime.close()
  }
})
