import { expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  botAvatarPreviewSchema,
  botResultSchema,
  decode,
  effectivePermissionPolicy,
  defaultTaskHarness,
} from '@dovo/protocol'
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

it('runs a selected harness in a temporary session without changing the Bot and replays only the exact request', async () => {
  const f = await setupBotRuntime()
  const task = f.draft()
  task.harness = { ...task.harness!, permission: 'workspace-write' }
  const created = decode(botResultSchema, await (await f.create(task)).response.json())
  const before = f.runtime.services.store.task(created.id)
  f.runtime.run.mockImplementation(async (run) => {
    expect(run.agent.provider).toBe('claude')
    expect(run.agent.permission).toBe('workspace-write')
    expect(run.ephemeral).toBe(true)
    expect(run.sessionId).toBeUndefined()
    expect(effectivePermissionPolicy(run.agent).readOnly).toBe(false)
    await writeFile(join(run.cwd, 'avatar.png'), await pixels())
  })
  const input = {
    id: created.id,
    requestId: randomUUID(),
    prompt: 'An owl',
    harnessId: 'harness:claude',
  }
  expect((await f.request('/api/bots/avatar/generate', input)).status).toBe(200)
  expect((await f.request('/api/bots/avatar/generate', input)).status).toBe(200)
  expect(
    (await f.request('/api/bots/avatar/generate', { ...input, harnessId: 'harness:codex' })).status,
  ).toBe(409)
  expect(f.runtime.run).toHaveBeenCalledTimes(1)
  expect(f.runtime.services.store.task(created.id)).toEqual(before)
})

it('rejects missing harnesses and cannot bypass a read-only Bot with a different harness', async () => {
  const f = await setupBotRuntime()
  const task = f.draft()
  task.harness = { ...task.harness!, permission: 'read-only' }
  const created = decode(botResultSchema, await (await f.create(task)).response.json())
  for (const harnessId of ['agent:removed', 'acp:removed', 'harness:claude']) {
    const result = await f.request('/api/bots/avatar/generate', {
      id: created.id,
      requestId: randomUUID(),
      prompt: 'An owl',
      harnessId,
    })
    expect(result.status).toBe(400)
  }
  expect(f.runtime.run).not.toHaveBeenCalled()
})

it.each(['saved', 'acp'] as const)(
  'uses the selected %s agent configuration and Bot resources',
  async (kind) => {
    const f = await setupBotRuntime()
    const created = decode(botResultSchema, await (await f.create()).response.json())
    const skill = {
      name: 'avatar-image',
      description: 'Generate images',
      content: 'Use the image tool',
      enabled: true,
    }
    const saved = {
      ...defaultTaskHarness('claude'),
      id: 'image-agent',
      name: 'Image agent',
      model: 'image-model',
      resources: { skills: [skill], mcpServers: [] },
    }
    const workspace = f.runtime.services.store.get()
    vi.spyOn(f.runtime.services.store, 'get').mockReturnValue({
      ...workspace,
      agents: [...workspace.agents, saved],
    })
    vi.spyOn(f.runtime.services.acpInstallations, 'list').mockReturnValue([
      {
        id: 'image-acp',
        registryId: 'image-acp',
        name: 'Image ACP',
        version: '1',
        distribution: 'npx',
        installedAt: new Date().toISOString(),
      },
    ])
    const task = f.runtime.services.store.taskSummary(created.id)
    expect(
      (
        await f.request('/api/bots/update', {
          id: task.id,
          expectedRevision: task.bot!.revision,
          resources: { skills: [{ ...skill, name: 'bot-image' }], mcpServers: [] },
        })
      ).status,
    ).toBe(200)
    f.runtime.run.mockImplementation(async (run) => {
      expect(run.ephemeral).toBe(true)
      expect(run.agent.provider).toBe(kind === 'saved' ? 'claude' : 'acp')
      expect(run.agent.acpInstallationId).toBe(kind === 'acp' ? 'image-acp' : undefined)
      expect(run.agent.resources?.skills.map((skill) => skill.name)).toContain('bot-image')
      if (kind === 'saved') {
        expect(run.agent.model).toBe('image-model')
        expect(run.agent.resources?.skills.map((skill) => skill.name)).toContain('avatar-image')
      }
      await writeFile(join(run.cwd, 'avatar.png'), await pixels())
    })
    const result = await f.request('/api/bots/avatar/generate', {
      id: created.id,
      requestId: randomUUID(),
      prompt: 'An owl',
      harnessId: kind === 'saved' ? 'agent:image-agent' : 'acp:image-acp',
    })
    expect(result.status).toBe(200)
  },
)
