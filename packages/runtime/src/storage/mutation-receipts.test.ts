import { expect, it, vi } from 'vite-plus/test'
import { openDatabase } from './database.js'
import { MutationReceipts } from './mutation-receipts.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
it('retries explicitly repeatable saves after 5xx without repeating uncertain side effects', async () => {
  const db = openDatabase(':memory:')
  try {
    const receipts = new MutationReceipts(db)
    const save = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('Database busy'))
      .mockResolvedValue({ ok: true })
    await expect(receipts.execute('phone', 'save', {}, save, true)).rejects.toThrow('Database busy')
    expect(await receipts.execute('phone', 'save', {}, save, true)).toEqual({ ok: true })
    const write = vi.fn<() => Promise<unknown>>(async () => {
      throw new Error('Git failed')
    })
    await expect(receipts.execute('phone', 'write', {}, write)).rejects.toThrow('Git failed')
    await expect(receipts.execute('phone', 'write', {}, write)).rejects.toThrow(
      'previous attempt failed',
    )
    expect(write).toHaveBeenCalledOnce()
    receipts.revoke('phone')
    expect(db.prepare('SELECT count(*) AS count FROM mutation_receipts').get()).toEqual({
      count: 0,
    })
  } finally {
    db.close()
  }
})
it('compacts acknowledged results while retaining deduplication and unresolved receipts', async () => {
  const db = openDatabase(':memory:')
  try {
    const receipts = new MutationReceipts(db)
    const run = vi.fn<() => Promise<{ large: string }>>(async () => ({ large: 'x'.repeat(10000) }))
    await receipts.execute('phone', 'done', {}, run)
    db.prepare('INSERT INTO mutation_receipts VALUES (?,?,?,NULL)').run(
      'phone',
      'uncertain',
      'fingerprint',
    )
    receipts.acknowledge('phone', ['done', 'uncertain'])
    expect(db.prepare('SELECT result FROM mutation_receipts WHERE id=?').get('done')).toEqual({
      result: '{"retired":true}',
    })
    expect(db.prepare('SELECT result FROM mutation_receipts WHERE id=?').get('uncertain')).toEqual({
      result: null,
    })
    await expect(new MutationReceipts(db).execute('phone', 'done', {}, run)).rejects.toThrow(
      'already acknowledged',
    )
    expect(run).toHaveBeenCalledOnce()
  } finally {
    db.close()
  }
})
it('replays committed responses across restart without repeating work or accepting changed payloads', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-receipts-'))
  let db = openDatabase(join(directory, 'runtime.sqlite'))
  try {
    const execute = vi.fn<() => Promise<{ ok: boolean; revision: number }>>(async () => ({
      ok: true,
      revision: 4,
    }))
    const receipts = new MutationReceipts(db)
    const request = { path: '/api/tasks/lifecycle', input: { id: 'task', action: 'delete' } }
    const first = await receipts.execute('phone', 'action', request, execute)
    db.close()
    db = openDatabase(join(directory, 'runtime.sqlite'))
    const reopened = new MutationReceipts(db)
    expect(await reopened.execute('phone', 'action', request, execute)).toEqual(first)
    expect(execute).toHaveBeenCalledOnce()
    await expect(reopened.execute('phone', 'action', { different: true }, execute)).rejects.toThrow(
      'another request',
    )
    await reopened.execute('other-phone', 'action', request, execute)
    expect(execute).toHaveBeenCalledTimes(2)
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
it('shares concurrent retries and refuses uncertain side effects after process loss', async () => {
  const db = openDatabase(':memory:')
  try {
    const receipts = new MutationReceipts(db)
    let finish: (value: unknown) => void = () => {}
    const run = vi.fn<() => Promise<unknown>>(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = receipts.execute('phone', 'action', {}, run)
    await Promise.resolve()
    const retry = receipts.execute('phone', 'action', {}, run)
    expect(run).toHaveBeenCalledOnce()
    const restarted = new MutationReceipts(db)
    await expect(restarted.execute('phone', 'action', {}, run)).rejects.toThrow('restarted')
    finish({ ok: true })
    expect(await retry).toEqual(await pending)
  } finally {
    db.close()
  }
})
