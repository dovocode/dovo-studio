import { afterEach, expect, it } from 'vite-plus/test'
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { rotateRuntimeLogs } from './log-rotation'

const paths: string[] = []
afterEach(async () => {
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true })
})
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'dovo-log-rotation-'))
  paths.push(dir)
  return { dir, path: join(dir, 'runtime-service.log') }
}

it('bounds the archived tail, leaves small logs untouched and keeps the append descriptor valid', async () => {
  const f = await setup()
  const writer = await open(f.path, 'a')
  try {
    await writer.write('small\n')
    await rotateRuntimeLogs(f.dir, 100)
    expect(await stat(f.path + '.1').catch(() => null)).toBeNull()
    expect(await readFile(f.path, 'utf8')).toBe('small\n')
    await writer.write('x'.repeat(300) + '\nnewest\n')
    await rotateRuntimeLogs(f.dir, 100)
    const archived = await readFile(f.path + '.1', 'utf8')
    expect(archived.length).toBe(100)
    expect(archived.endsWith('newest\n')).toBe(true)
    expect((await stat(f.path)).size).toBe(0)
    await writer.write('after rotation\n')
    expect(await readFile(f.path, 'utf8')).toBe('after rotation\n')
  } finally {
    await writer.close()
  }
})
