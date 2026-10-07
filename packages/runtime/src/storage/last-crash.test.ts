import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { clearLastCrash, lastCrashFile, readLastCrash } from './last-crash'

it('reports a crash record once per start and forgets it when dismissed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-crash-'))
  const databasePath = join(directory, 'runtime.sqlite')
  try {
    expect(readLastCrash(':memory:')).toBeUndefined()
    await writeFile(
      lastCrashFile(databasePath),
      JSON.stringify({ at: '2026-10-07T10:00:00.000Z', message: 'TypeError: boom', stack: 'x' }),
    )
    expect(readLastCrash(databasePath)).toEqual({
      at: '2026-10-07T10:00:00.000Z',
      message: 'TypeError: boom',
    })
    clearLastCrash(databasePath)
    expect(readLastCrash(databasePath)).toBeUndefined()
    await writeFile(lastCrashFile(databasePath), 'not json')
    clearLastCrash(databasePath)
    expect(readLastCrash(databasePath)).toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
