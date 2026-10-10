import { afterEach, expect, it } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const token = 'dovo-memory-owner-token-at-least-32-characters'
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => ({
    ...f.workspace,
    repositories: [
      ...f.workspace.repositories,
      { ...f.workspace.repositories[0], id: 'other', name: 'Other' },
    ],
  }))
  const create = (repositoryId = 'repo') =>
    s.tasks.create({ title: 'Memory', repositoryId, agentId: 'agent', objective: 'Work' })
  const post = async (path: string, input: unknown, credential = token) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/memory/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const value: unknown = await response.json()
    return { status: response.status, value }
  }
  return { s, create, post, runtime }
}

it('starts all scopes off, configures projects independently, and immediately blocks disabled scopes without erasing notes', async () => {
  const { s, create, post } = await setup()
  const task = create()
  expect(s.memory.settings()).toEqual({
    systemEnabled: false,
    projectlessEnabled: false,
    projectRepositoryIds: [],
  })
  expect(s.memory.availableScopes(task.id)).toEqual([])
  expect((await post('agent/list', { taskId: task.id, scope: 'project' })).status).toBe(403)
  expect(
    (await post('settings/save', { scope: 'project', repositoryId: 'missing', enabled: true }))
      .status,
  ).toBe(400)
  await post('settings/save', { scope: 'project', repositoryId: 'repo', enabled: true })
  expect(s.memory.availableScopes(task.id)).toEqual(['project'])
  expect(s.memory.availableScopes(create('other').id)).toEqual([])
  expect(
    (
      await post('agent/write', {
        taskId: task.id,
        scope: 'project',
        key: 'conventions',
        content: 'Use pnpm',
      })
    ).status,
  ).toBe(200)
  await post('settings/save', { scope: 'project', repositoryId: 'repo', enabled: false })
  expect(
    (await post('agent/read', { taskId: task.id, scope: 'project', key: 'conventions' })).status,
  ).toBe(403)
  expect(
    (await post('agent/write', { taskId: task.id, scope: 'project', key: 'new', content: 'No' }))
      .status,
  ).toBe(403)
  expect(
    s.memory.read({ scope: 'project', repositoryId: 'repo', key: 'conventions' }).content,
  ).toBe('Use pnpm')
})

it('shares notes across project threads while isolating other projects, system memory, and projectless threads', async () => {
  const { s, create, post } = await setup()
  const first = create(),
    second = create(),
    other = create('other'),
    projectless = create('')
  s.memory.configure({ scope: 'project', repositoryId: 'repo', enabled: true })
  s.memory.configure({ scope: 'project', repositoryId: 'other', enabled: true })
  s.memory.configure({ scope: 'system', enabled: true })
  s.memory.configure({ scope: 'projectless', enabled: true })
  s.memory.write({
    scope: 'project',
    repositoryId: 'repo',
    key: 'conventions',
    content: 'Use pnpm',
  })
  s.memory.write({
    scope: 'project',
    repositoryId: 'other',
    key: 'conventions',
    content: 'Use npm',
  })
  s.memory.write({ scope: 'system', key: 'preferences', content: 'Concise responses' })
  s.memory.write({ scope: 'projectless', key: 'notes', content: 'Personal planning' })
  expect(
    (await post('agent/read', { taskId: first.id, scope: 'project', key: 'conventions' })).value,
  ).toMatchObject({ memory: { content: 'Use pnpm' } })
  expect(
    (await post('agent/read', { taskId: second.id, scope: 'project', key: 'conventions' })).value,
  ).toMatchObject({ memory: { content: 'Use pnpm' } })
  expect(
    (await post('agent/read', { taskId: other.id, scope: 'project', key: 'conventions' })).value,
  ).toMatchObject({ memory: { content: 'Use npm' } })
  expect(
    (
      await post('agent/read', {
        taskId: first.id,
        scope: 'project',
        repositoryId: 'other',
        key: 'conventions',
      })
    ).status,
  ).toBe(400)
  expect(
    (await post('agent/read', { taskId: first.id, scope: 'projectless', key: 'notes' })).status,
  ).toBe(403)
  expect(
    (await post('agent/read', { taskId: projectless.id, scope: 'project', key: 'conventions' }))
      .status,
  ).toBe(403)
  expect(s.memory.availableScopes(projectless.id)).toEqual(['system', 'projectless'])
  for (const task of [first, other, projectless])
    expect(
      (await post('agent/read', { taskId: task.id, scope: 'system', key: 'preferences' })).status,
    ).toBe(200)
  const listed = await post('agent/list', { taskId: second.id, scope: 'project', query: 'pnpm' })
  expect(listed.value).toMatchObject({ total: 1, entries: [{ key: 'conventions' }] })
  expect(listed.value).toMatchObject({
    entries: [expect.not.objectContaining({ content: expect.any(String) })],
  })
})

it('keeps read-only agents from changing memory and authenticates agent access', async () => {
  const { s, create, post } = await setup()
  const task = create()
  s.memory.configure({ scope: 'system', enabled: true })
  s.memory.write({ scope: 'system', key: 'preferences', content: 'Saved' })
  s.store.updateTask(task.id, (current) => ({
    ...current,
    agentOverrides: { ...current.agentOverrides, permission: 'read-only' },
  }))
  expect(
    (await post('agent/read', { taskId: task.id, scope: 'system', key: 'preferences' })).status,
  ).toBe(200)
  expect(
    (await post('agent/write', { taskId: task.id, scope: 'system', key: 'new', content: 'Denied' }))
      .status,
  ).toBe(403)
  expect(
    (
      await post('agent/delete', {
        taskId: task.id,
        scope: 'system',
        key: 'preferences',
        expectedRevision: '00000000-0000-0000-0000-000000000000',
      })
    ).status,
  ).toBe(403)
  expect(
    (await post('agent/read', { taskId: task.id, scope: 'system', key: 'preferences' }, 'invalid'))
      .status,
  ).toBe(401)
  s.devices.add('Phone', 'paired-memory-test-token')
  expect(
    (
      await post(
        'agent/read',
        { taskId: task.id, scope: 'system', key: 'preferences' },
        'paired-memory-test-token',
      )
    ).status,
  ).toBe(403)
})

it('rejects stale revisions, supports pagination and search, and retains memory when projects are removed', async () => {
  const { s } = await setup()
  const first = s.memory.write({
    scope: 'project',
    repositoryId: 'repo',
    key: 'conventions',
    content: 'Initial',
  })
  const updated = s.memory.write({
    scope: 'project',
    repositoryId: 'repo',
    key: first.key,
    content: 'Updated',
    expectedRevision: first.revision,
  })
  expect(() =>
    s.memory.write({
      scope: 'project',
      repositoryId: 'repo',
      key: first.key,
      content: 'Stale',
      expectedRevision: first.revision,
    }),
  ).toThrow('Memory changed')
  expect(() =>
    s.memory.remove({
      scope: 'project',
      repositoryId: 'repo',
      key: first.key,
      expectedRevision: first.revision,
    }),
  ).toThrow('Memory changed')
  for (let index = 0; index < 51; index++)
    s.memory.write({
      scope: 'system',
      key: `note-${index.toString().padStart(2, '0')}`,
      content: 'Note',
    })
  expect(s.memory.list({ scope: 'system' })).toMatchObject({
    total: 51,
    entries: expect.any(Array),
  })
  expect(s.memory.list({ scope: 'system' }).entries).toHaveLength(50)
  expect(s.memory.list({ scope: 'system', offset: 50 }).entries).toHaveLength(1)
  expect(
    s.memory.list({ scope: 'project', repositoryId: 'repo', query: 'updated' }).entries,
  ).toHaveLength(1)
  s.memory.write({ scope: 'system', key: 'Örganisation', content: 'Unicode note' })
  expect(s.memory.list({ scope: 'system', query: 'Örganisation' }).entries).toHaveLength(1)
  s.store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.filter((project) => project.id !== 'repo'),
  }))
  expect(s.memory.projects().projects).toContainEqual({
    id: 'repo',
    name: 'Removed project (repo)',
    registered: false,
  })
  expect(s.memory.read({ scope: 'project', repositoryId: 'repo', key: first.key }).content).toBe(
    'Updated',
  )
  s.memory.remove({
    scope: 'project',
    repositoryId: 'repo',
    key: first.key,
    expectedRevision: updated.revision,
  })
  expect(() => s.memory.read({ scope: 'project', repositoryId: 'repo', key: first.key })).toThrow(
    'Memory not found',
  )
})

it('rejects old revision tokens after a note is deleted and recreated under the same key', async () => {
  const { s } = await setup()
  const first = s.memory.write({ scope: 'system', key: 'preference', content: 'First' })
  s.memory.remove({ scope: 'system', key: first.key, expectedRevision: first.revision })
  const replacement = s.memory.write({ scope: 'system', key: first.key, content: 'Replacement' })
  expect(replacement.revision).not.toBe(first.revision)
  expect(() =>
    s.memory.write({
      scope: 'system',
      key: first.key,
      content: 'Stale',
      expectedRevision: first.revision,
    }),
  ).toThrow('Memory changed')
  expect(() =>
    s.memory.remove({ scope: 'system', key: first.key, expectedRevision: first.revision }),
  ).toThrow('Memory changed')
})

it('uses the delegated execution project and handles projectless and scratch ancestry', async () => {
  const { s, create } = await setup()
  const parent = create()
  s.store.updateTask(parent.id, (task) => ({
    ...task,
    linkedCheckouts: [{ id: 'backend', repositoryId: 'other', execution: 'main', access: 'edit' }],
  }))
  const child = create()
  s.store.updateTask(child.id, (task) => ({
    ...task,
    delegation: {
      parentTaskId: parent.id,
      parentRunId: 'run',
      key: 'child',
      checkoutId: 'backend',
    },
  }))
  s.memory.configure({ scope: 'project', repositoryId: 'other', enabled: true })
  expect(s.memory.agentScope(child.id, 'project')).toEqual({
    scope: 'project',
    repositoryId: 'other',
  })
  const projectless = create(''),
    projectlessChild = create('')
  s.store.updateTask(projectlessChild.id, (task) => ({
    ...task,
    delegation: { parentTaskId: projectless.id, parentRunId: 'run', key: 'child' },
  }))
  s.memory.configure({ scope: 'projectless', enabled: true })
  expect(s.memory.availableScopes(projectlessChild.id)).toEqual(['projectless'])
  s.store.update((workspace) => ({
    ...workspace,
    repositories: [
      ...workspace.repositories,
      { id: 'scratch', name: 'Scratch', path: '/scratch', branch: '', kind: 'scratch' },
    ],
  }))
  expect(s.memory.availableScopes(create('scratch').id)).toEqual(['projectless'])
})

it('persists memory and settings across thread deletion and runtime restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-memory-persist-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const databasePath = join(directory, 'runtime.sqlite')
  const runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  const task = runtime.services.tasks.create({
    title: 'Projectless',
    agentId: '',
    repositoryId: '',
    objective: 'Work',
  })
  runtime.services.memory.configure({ scope: 'projectless', enabled: true })
  runtime.services.memory.write({ scope: 'projectless', key: 'preference', content: 'Retain this' })
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.filter((item) => item.id !== task.id),
  }))
  await runtime.close()
  const restarted = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(() => restarted.close())
  expect(restarted.services.memory.settings().projectlessEnabled).toBe(true)
  expect(restarted.services.memory.read({ scope: 'projectless', key: 'preference' }).content).toBe(
    'Retain this',
  )
})

it('keeps removed enabled scopes configurable even when they have no notes', async () => {
  const { s } = await setup()
  s.memory.configure({ scope: 'project', repositoryId: 'other', enabled: true })
  s.store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.filter((project) => project.id !== 'other'),
  }))
  expect(s.memory.projects().projects).toContainEqual({
    id: 'other',
    name: 'Removed project (other)',
    registered: false,
  })
  s.memory.configure({ scope: 'project', repositoryId: 'other', enabled: false })
  expect(s.memory.settings().projectRepositoryIds).not.toContain('other')
})

it('rejects the general preference route for memory changes so project validation cannot be bypassed', async () => {
  const { runtime, s } = await setup()
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/runtime/preferences/save`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      memory: { systemEnabled: true, projectlessEnabled: true, projectRepositoryIds: ['forged'] },
    }),
  })
  expect(response.status).toBe(400)
  expect(s.memory.settings()).toEqual({
    systemEnabled: false,
    projectlessEnabled: false,
    projectRepositoryIds: [],
  })
})
