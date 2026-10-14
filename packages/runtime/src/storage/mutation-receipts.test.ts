import { createHash } from 'node:crypto'
import { WorkspaceStore } from './workspace.js'
import { expect, it, vi } from 'vite-plus/test'
import { openDatabase } from './database.js'
import { HttpError } from '../errors.js'
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

it('identifies rejected workspace edits across receipt recovery without marking uncertain outcomes', async () => {
  const db = openDatabase(':memory:')
  try {
    const receipts = new MutationReceipts(db)
    const input = { method: 'PATCH', path: '/api/workspace', input: {} }
    const run = vi.fn<() => Promise<never>>(async () => {
      throw new HttpError(409, 'Another client changed harness')
    })
    await expect(receipts.execute('phone', 'rejected', input, run)).rejects.toMatchObject({
      status: 409,
      mutationRejected: true,
    })
    await expect(
      new MutationReceipts(db).execute('phone', 'rejected', input, run),
    ).rejects.toMatchObject({ status: 409, mutationRejected: true })
    expect(run).toHaveBeenCalledOnce()
    await expect(
      receipts.execute('phone', 'rejected', { ...input, input: { different: true } }, run),
    ).rejects.not.toHaveProperty('mutationRejected')
    const failed = async () => {
      throw Error('Disk failed')
    }
    await expect(receipts.execute('phone', 'uncertain', input, failed)).rejects.toThrow(
      'Disk failed',
    )
    await expect(
      new MutationReceipts(db).execute('phone', 'uncertain', input, failed),
    ).rejects.not.toHaveProperty('mutationRejected')
  } finally {
    db.close()
  }
})
it('commits workspace state and its receipt atomically, including live snapshot rollback', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      repositories: [{ id: 'repo', name: 'A', path: '/repo', branch: 'main' }],
    }))
    const receipts = new MutationReceipts(db)
    const request = {
      method: 'PATCH',
      path: '/api/workspace',
      input: {
        collection: 'repositories' as const,
        id: 'repo',
        changes: { name: { before: 'A', after: 'B' } },
      },
    }
    db.exec(
      "CREATE TRIGGER fail_workspace_receipt BEFORE UPDATE ON mutation_receipts BEGIN SELECT RAISE(ABORT,'Injected receipt failure'); END",
    )
    const apply = () =>
      store.transaction(() =>
        receipts.executeWorkspace(
          'phone',
          'atomic',
          request,
          () => {
            store.patch(request.input)
            return { revision: store.version(), runtimeInstanceId: 'runtime', outcome: 'applied' }
          },
          () => {
            throw new Error('Unexpected settlement')
          },
        ),
      )
    expect(apply).toThrow('Injected receipt failure')
    expect(store.get().repositories[0].name).toBe('A')
    expect(new WorkspaceStore(db).get().repositories[0].name).toBe('A')
    expect(db.prepare('SELECT count(*) AS count FROM mutation_receipts').get()).toEqual({
      count: 0,
    })
    db.exec('DROP TRIGGER fail_workspace_receipt')
    apply()
    store.patch({ ...request.input, changes: { name: { before: 'B', after: 'A' } } })
    new MutationReceipts(db).acknowledge('phone', ['atomic'])
    apply()
    expect(store.get().repositories[0].name).toBe('A')
    expect(store.recoveredEdits()).toEqual([])
  } finally {
    db.close()
  }
})
it('settles an interrupted legacy workspace receipt without repeating its write', () => {
  const db = openDatabase(':memory:')
  try {
    const request = { method: 'PATCH', path: '/api/workspace', input: {} }
    const receipts = new MutationReceipts(db)
    db.prepare('INSERT INTO mutation_receipts VALUES (?,?,?,NULL)').run(
      'phone',
      'old',
      createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    )
    const run = vi.fn<() => { revision: number }>(() => ({ revision: 2 }))
    const settle = vi.fn<() => { revision: number; reconciled: boolean }>(() => ({
      revision: 1,
      reconciled: true,
    }))
    expect(receipts.executeWorkspace('phone', 'old', request, run, settle)).toEqual({
      revision: 1,
      reconciled: true,
    })
    expect(run).not.toHaveBeenCalled()
    expect(settle).toHaveBeenCalledExactlyOnceWith('interrupted', undefined)
    receipts.executeWorkspace('phone', 'old', request, run, settle)
    expect(settle).toHaveBeenCalledOnce()
  } finally {
    db.close()
  }
})

it('does not rewrite already retired receipts during repeated acknowledgements', async () => {
  const db = openDatabase(':memory:')
  try {
    const receipts = new MutationReceipts(db)
    await receipts.execute('phone', 'operation', {}, async () => ({ large: 'x'.repeat(10000) }))
    receipts.acknowledge('phone', ['operation', 'operation'])
    const before = db.prepare('SELECT total_changes() AS count').get()
    receipts.acknowledge('phone', ['operation'])
    expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before)
    expect(
      JSON.stringify(db.prepare('SELECT result FROM mutation_receipts').get()).length,
    ).toBeLessThan(100)
  } finally {
    db.close()
  }
})
