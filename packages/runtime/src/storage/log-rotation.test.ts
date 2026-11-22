import { afterEach, expect, it } from 'vite-plus/test'
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { rotateRuntimeLog } from './log-rotation'

const paths: string[] = []
afterEach(async () => {
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true })
})
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'dovo-log-rotation-'))
  paths.push(dir)
  return { dir, path: join(dir, 'runtime-service.log') }
}

it('leaves small logs untouched and preserves late appends in the archived log', async () => {
  const f = await setup()
  const writer = await open(f.path, 'a')
  try {
    await writer.write('small\n')
    rotateRuntimeLog(f.path, 100)
    expect(await stat(f.path + '.1').catch(() => null)).toBeNull()
    expect(await readFile(f.path, 'utf8')).toBe('small\n')
    await writer.write('x'.repeat(300) + '\nnewest\n')
    rotateRuntimeLog(f.path, 100)
    const next = await open(f.path, 'a', 0o600)
    try {
      await Promise.all([writer.write('late append\n'), next.write('new generation\n')])
    } finally {
      await next.close()
    }
    expect(await readFile(f.path + '.1', 'utf8')).toBe(
      'small\n' + 'x'.repeat(300) + '\nnewest\nlate append\n',
    )
    expect(await readFile(f.path, 'utf8')).toBe('new generation\n')
  } finally {
    await writer.close()
  }
})
