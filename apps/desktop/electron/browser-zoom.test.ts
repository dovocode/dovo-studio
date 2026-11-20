import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const f = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => f.root } }))
import { createBrowserZoom } from './browser-zoom'
beforeEach(async () => {
  f.root = await mkdtemp(join(tmpdir(), 'browser-zoom-'))
})
afterEach(async () => {
  await rm(f.root, { recursive: true, force: true })
})

it('keeps valid site zoom from a damaged store and preserves the original', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  const directory = join(f.root, 'browser-zoom')
  await mkdir(directory, { recursive: true })
  const damaged = JSON.stringify({ 'https://kept.example': 1.5, 'https://broken.example': 'big' })
  await writeFile(join(directory, 'work.json'), damaged)
  await writeFile(join(directory, 'personal.json'), '{"https://cut.example": 1.')
  const zoom = createBrowserZoom()
  expect(zoom.get('work', 'https://kept.example/page')).toBe(1.5)
  expect(zoom.get('work', 'https://broken.example/')).toBe(1)
  expect(zoom.get('personal', 'https://cut.example/')).toBe(1)
  const files = await readdir(directory)
  const backup = files.find((name) => name.startsWith('work.json.damaged-'))!
  expect(await readFile(join(directory, backup), 'utf8')).toBe(damaged)
  expect(files.filter((name) => name.startsWith('personal.json.damaged-'))).toHaveLength(1)
  expect(JSON.parse(await readFile(join(directory, 'work.json'), 'utf8'))).toEqual({
    'https://kept.example': 1.5,
  })
  // A later change keeps the recovered sites.
  zoom.set('work', 'https://new.example/', 2)
  expect(createBrowserZoom().get('work', 'https://kept.example/')).toBe(1.5)
  logged.mockRestore()
})

it('leaves an unreadable store untouched', async () => {
  await mkdir(join(f.root, 'browser-zoom', 'work.json'), { recursive: true })
  expect(() => createBrowserZoom().get('work', 'https://example.com/')).toThrow(
    'Could not read browser zoom settings.',
  )
  expect(await readdir(join(f.root, 'browser-zoom'))).toEqual(['work.json'])
})
