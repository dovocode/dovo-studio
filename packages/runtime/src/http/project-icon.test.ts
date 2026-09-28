import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { startRuntime } from '../index'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

it('shares discovered and customized project icons through the runtime snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-icon-api-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'app'))
  const png = await sharp({ create: { width: 80, height: 80, channels: 4, background: '#ff8800' } })
    .png()
    .toBuffer()
  await writeFile(join(root, 'app', 'icon.png'), png)
  const token = 'project-icon-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [{ id: 'project', name: 'Project', path: root, branch: 'main' }],
  }))
  const url = `http://127.0.0.1:${runtime.port}`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const snapshot = async () =>
    (await (await fetch(`${url}/api/snapshot`, { headers })).json()).workspace.repositories[0]
  expect((await snapshot()).discoveredIcon).toMatch(/^data:image\/png;base64,/)
  const response = await fetch(`${url}/api/scm/repositories/icon`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ repositoryId: 'project', data: png.toString('base64') }),
  })
  expect(response.status).toBe(200)
  expect((await snapshot()).iconOverride).toMatch(/^data:image\/png;base64,/)
  expect(
    (
      await fetch(`${url}/api/scm/repositories/icon`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ repositoryId: 'project' }),
      })
    ).status,
  ).toBe(200)
  expect((await snapshot()).iconOverride).toBeUndefined()
})
