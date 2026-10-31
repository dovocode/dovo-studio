import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { runtimeIntegration } from '../testing/integration'
import { RemoteBrowsers } from '../previews/browser'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it('requires paired credentials and a live task before reading browser elements, and validates coordinates', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = 'browser-element-test-token-with-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Browser feedback',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const snapshot = {
    url: 'http://lan.local:3000/',
    title: 'Local app',
    width: 800,
    height: 600,
    scrollX: 0,
    scrollY: 0,
    document: 123,
  }
  const element = {
    selector: '#save',
    tag: 'button',
    text: 'Save',
    label: '',
    rect: { x: 1, y: 2, width: 100, height: 40 },
  }
  const read = vi.spyOn(s.browsers, 'element').mockResolvedValue({ element })
  const call = (action: string, input: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/previews/browser/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  expect((await call('element-snapshot', { taskId: task.id }, 'wrong')).status).toBe(401)
  expect((await call('element-snapshot', { taskId: 'missing' })).status).toBe(404)
  expect((await call('element-inspect', { taskId: task.id, snapshot, x: 2, y: 0.5 })).status).toBe(
    400,
  )
  expect(read).not.toHaveBeenCalled()
  const response = await call('element-inspect', {
    taskId: task.id,
    tabId: 'tab',
    snapshot,
    x: 0.5,
    y: 0.5,
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ element })
  expect(read).toHaveBeenCalledWith(JSON.stringify([task.id, 'tab']), { snapshot, x: 0.5, y: 0.5 })
  read.mockResolvedValue({ snapshot, image: 'data:image/png;base64,eA==' })
  const captured = await call('element-snapshot', {
    taskId: task.id,
    tabId: 'other',
    profileId: 'custom',
  })
  expect(captured.status).toBe(200)
  expect(await captured.json()).toMatchObject({ snapshot })
  expect(read).toHaveBeenLastCalledWith(JSON.stringify([task.id, 'other', 'custom']), undefined)
})

it('rejects stale captures and empty picks, and bounds hung page inspection', async () => {
  const snapshot = {
    url: 'http://lan.local:3000/',
    title: 'Local app',
    width: 800,
    height: 600,
    scrollX: 0,
    scrollY: 0,
    document: 123,
  }
  const page = {
    isClosed: () => false,
    evaluate: vi.fn<() => Promise<unknown>>(),
    screenshot: vi.fn<() => Promise<Buffer>>(async () => Buffer.from('image')),
  }
  const browsers = new RemoteBrowsers('/runtime/browser.profiles')
  const sessions = new Map([['tab', Promise.resolve({ page })]])
  Object.defineProperty(browsers, 'sessions', { value: sessions })
  cleanups.push(async () => {
    sessions.clear()
    await browsers.dispose()
  })
  await expect(browsers.element('missing')).rejects.toMatchObject({ status: 404 })
  page.evaluate.mockResolvedValueOnce(snapshot).mockResolvedValueOnce({ ...snapshot, scrollY: 1 })
  await expect(browsers.element('tab')).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining('page moved or changed'),
  })
  page.evaluate.mockResolvedValueOnce(null)
  await expect(browsers.element('tab', { snapshot, x: 0.5, y: 0.5 })).rejects.toMatchObject({
    status: 404,
    message: 'No element at that point. Pick another spot.',
  })
  vi.useFakeTimers()
  try {
    page.evaluate.mockImplementation(() => new Promise(() => {}))
    const result = browsers.element('tab', { snapshot, x: 0.5, y: 0.5 })
    const rejected = result.then(
      () => {
        throw new Error('Expected the inspection to time out')
      },
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(10001)
    expect(await rejected).toMatchObject({ status: 504 })
  } finally {
    vi.useRealTimers()
  }
})
