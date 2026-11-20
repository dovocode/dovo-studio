import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STUDIO_TERMINAL_SCOPE } from '@dovo/protocol'
import { openDatabase } from '../storage/database.js'
import { TerminalRecovery } from './recovery.js'
import { Terminals } from './terminals.js'

it('retains a read turn and rejects a delayed view after Mark unread or a newer completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-seen-turn-'))
  const db = openDatabase(join(directory, 'runtime.sqlite'))
  const recovery = new TerminalRecovery(db, join(directory, 'recovery'))
  const id = randomUUID()
  recovery.put({
    info: {
      id,
      taskId: STUDIO_TERMINAL_SCOPE,
      directory,
      title: 'Test',
      exited: true,
      turn: 3,
      seenTurn: 0,
    },
    shell: { command: '/bin/sh', args: [] },
  })
  const terminals = new Terminals(undefined, undefined, undefined, recovery, { holder: false })
  try {
    const update = (turn: number, expectedRevision: number, seen: boolean) =>
      terminals.update({ id, view: { turn, expectedRevision, seen } })
    await expect(update(2, 0, true)).rejects.toThrow('Terminal activity changed')
    expect(await update(3, 0, true)).toMatchObject({ turn: 3, seenTurn: 3, seenRevision: 1 })
    expect(await update(3, 1, false)).toMatchObject({ turn: 3, seenTurn: 2, seenRevision: 2 })
    await expect(update(3, 1, true)).rejects.toThrow('Terminal activity changed')
    expect(new TerminalRecovery(db).list()[0]?.info).toMatchObject({
      turn: 3,
      seenTurn: 2,
      seenRevision: 2,
    })
    expect(await update(3, 2, true)).toMatchObject({ seenTurn: 3, seenRevision: 3 })
  } finally {
    await terminals.dispose()
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
})
