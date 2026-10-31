import { afterEach, expect, it, vi } from 'vite-plus/test'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  codexSessionMetadata,
  readCodexSessionHeader,
  readCodexTranscript,
} from './session-transcript'

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
}))
const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})
async function fixture() {
  const directory = await fs.mkdtemp(join(tmpdir(), 'dovo-codex-header-'))
  directories.push(directory)
  return join(directory, 'rollout.jsonl')
}

it('reads only the metadata header in one 1 KiB request even for an oversized or corrupt transcript body', async () => {
  const path = await fixture()
  const header = JSON.stringify({
    type: 'session_meta',
    payload: { id: 'session', cwd: '/project', source: 'cli' },
  })
  await fs.writeFile(path, header + '\nnot valid transcript JSON\n')
  await fs.truncate(path, 32 * 1024 * 1024)
  const file = await fs.open(path, 'r')
  const read = vi.spyOn(file, 'read')
  vi.spyOn(fs, 'open').mockResolvedValue(file)
  const result = await readCodexSessionHeader(path)
  expect(result.text).toBe(header)
  expect(codexSessionMetadata(result.text)?.id).toBe('session')
  expect(read).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenNthCalledWith(1, expect.any(Buffer), 0, 1024, 0)
  expect(file.fd).toBe(-1)
})

it('limits oversized metadata lines to 64 KiB and never treats a partial header as metadata', async () => {
  const path = await fixture()
  await fs.writeFile(
    path,
    JSON.stringify({
      type: 'session_meta',
      payload: { id: 'session', cwd: '/project', source: 'cli', padding: 'x'.repeat(100000) },
    }) + '\n',
  )
  const file = await fs.open(path, 'r')
  const read = vi.spyOn(file, 'read')
  vi.spyOn(fs, 'open').mockResolvedValue(file)
  const result = await readCodexSessionHeader(path)
  expect(result.text).toBe('')
  expect(read).toHaveBeenCalledTimes(64)
  for (let index = 0; index < 64; index++)
    expect(read).toHaveBeenNthCalledWith(
      index + 1,
      expect.any(Buffer),
      index * 1024,
      1024,
      index * 1024,
    )
  expect(file.fd).toBe(-1)
})

it('applies the full transcript size limit only when a user selects that session', async () => {
  const path = await fixture()
  const header = JSON.stringify({
    type: 'session_meta',
    payload: { id: 'session', cwd: '/project', source: 'cli' },
  })
  await fs.writeFile(path, header + '\n')
  await fs.truncate(path, 32 * 1024 * 1024)
  expect((await readCodexSessionHeader(path)).text).toBe(header)
  await expect(readCodexTranscript(path)).rejects.toMatchObject({ status: 413 })
})
