import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { clearLastCrash, lastCrashFile, readLastCrash, recordLastCrash } from './last-crash'

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

it('redacts crash messages and stacks before writing and redacts legacy reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-crash-redact-'))
  try {
    const databasePath = join(directory, 'runtime.sqlite')
    recordLastCrash(
      databasePath,
      new Error(
        'https://account:url-secret@example.test/path X-API-Key: persist-secret Authorization: Basic dXNlcjpwYXNz',
      ),
    )
    const saved = await readFile(lastCrashFile(databasePath), 'utf8')
    expect(saved).not.toContain('persist-secret')
    expect(saved).not.toContain('dXNlcjpwYXNz')
    expect(saved).not.toContain('url-secret')
    expect(saved).toContain('last-crash.test.ts')
    expect(readLastCrash(databasePath)?.message).not.toContain('persist-secret')
    const legacyPath = join(directory, 'legacy', 'runtime.sqlite')
    // A distinct path bypasses the once-per-start cache.
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(directory, 'legacy'))
    await writeFile(
      lastCrashFile(legacyPath),
      JSON.stringify({
        at: 'now',
        message: 'password="legacy-secret" http://user:legacy-url-secret@host/path',
      }),
    )
    expect(readLastCrash(legacyPath)?.message).not.toContain('legacy-secret')
    expect(readLastCrash(legacyPath)?.message).not.toContain('legacy-url-secret')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
