import { expect, it, vi } from 'vite-plus/test'
import { openDatabase } from './database.js'
import { MutationReceipts } from './mutation-receipts.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
