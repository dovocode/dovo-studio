import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { botAvatarPreviewSchema, botResultSchema, decode } from '@dovo/protocol'
import { setupBotRuntime } from '../../testing/bots'

const pixels = () =>
  sharp({ create: { width: 32, height: 32, channels: 4, background: '#4488aa' } })
    .png()
    .toBuffer()

it('normalizes uploaded pixels, applies only after review, and preserves the avatar on other Bot edits', async () => {
  const f = await setupBotRuntime()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const response = await f.request('/api/bots/avatar/upload', {
    id: created.id,
    data: (await pixels()).toString('base64'),
  })
  expect(response.status).toBe(200)
  const preview = decode(botAvatarPreviewSchema, await response.json())
  expect(preview.avatar).toMatch(/^data:image\/webp;base64,/)
  expect(f.runtime.services.store.taskSummary(created.id).bot?.avatar).toBeUndefined()
  const updated = decode(
    botResultSchema,
    await (
      await f.request('/api/bots/update', {
        id: created.id,
        expectedRevision: created.bot.revision,
        avatar: preview.avatar,
      })
    ).json(),
  )
  expect(updated.bot.avatar).toBe(preview.avatar)
  const paused = decode(
    botResultSchema,
    await (
      await f.request('/api/bots/lifecycle', {
        id: created.id,
        expectedRevision: updated.bot.revision,
        action: 'pause',
      })
    ).json(),
  )
  expect(paused.bot.avatar).toBe(preview.avatar)
  await f.restart()
  expect(f.runtime.services.store.taskSummary(created.id).bot?.avatar).toBe(preview.avatar)
  const removed = await f.request('/api/bots/update', {
    id: created.id,
    expectedRevision: paused.bot.revision,
    avatar: null,
  })
  expect(removed.status).toBe(200)
  expect(f.runtime.services.store.taskSummary(created.id).bot?.avatar).toBeUndefined()
  expect(
    (
      await f.request('/api/bots/avatar/upload', {
        id: created.id,
        data: Buffer.from('<svg/>').toString('base64'),
      })
    ).status,
  ).toBe(415)
})

it('uses one temporary session for a retried generation, cleans its folder and leaves the conversation unchanged', async () => {
  const f = await setupBotRuntime()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const before = f.runtime.services.store.task(created.id)
  let directory = ''
  f.runtime.run.mockImplementation(async (run) => {
    directory = run.cwd
    expect(run.ephemeral).toBe(true)
    expect(run.sessionId).toBeUndefined()
    expect(run.agent.resources?.mcpServers.some((server) => server.name === 'dovo_task')).toBe(
      false,
    )
    await writeFile(join(run.cwd, 'avatar.png'), await pixels())
  })
  const input = { id: created.id, requestId: randomUUID(), prompt: 'A friendly illustrated Bot' }
  const first = await f.request('/api/bots/avatar/generate', input)
  expect(first.status).toBe(200)
  const preview = await first.json()
  expect(await (await f.request('/api/bots/avatar/generate', input)).json()).toEqual(preview)
  expect(f.runtime.run).toHaveBeenCalledTimes(1)
  expect(f.runtime.services.store.task(created.id)).toEqual(before)
  await expect(access(directory)).rejects.toThrow(/ENOENT/)
})
