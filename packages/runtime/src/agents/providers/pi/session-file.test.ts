/// <reference types="node" />
import { afterEach, expect, it } from 'vite-plus/test'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPiSessionFile } from './session-file.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })),
  )
})

it('reads only the header of a large transcript and bounds selected transcript reads', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dovo-pi-import-'))
  directories.push(dir)
  const path = join(dir, 'session.jsonl')
  await fs.writeFile(path, '{"type":"session"}\n')
  await fs.truncate(path, 17 * 1024 * 1024)
  expect((await readPiSessionFile(path, 'header')).text).toBe('{"type":"session"}')
  await expect(readPiSessionFile(path, 'transcript')).rejects.toThrow('16 MiB')
})

it('does not follow a transcript symlink', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dovo-pi-import-'))
  directories.push(dir)
  const path = join(dir, 'session.jsonl')
  await fs.writeFile(path, '{}\n')
  const link = join(dir, 'link.jsonl')
  await fs.symlink(path, link)
  await expect(readPiSessionFile(link, 'transcript')).rejects.toThrow(/symbolic link|ELOOP/i)
})
