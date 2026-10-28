import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const f = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => f.root } }))
import { createBrowserHistory } from './browser-history'
beforeEach(async () => {
  f.root = await mkdtemp(join(tmpdir(), 'browser-history-'))
})
afterEach(async () => {
  await rm(f.root, { recursive: true, force: true })
})
it('records real visits and titles, persists per profile and reports visit removal', () => {
  const emit = vi.fn<(...args: unknown[]) => void>()
  const history = createBrowserHistory('work', emit)
  const contents = Object.assign(new EventEmitter(), {
    getTitle: () => 'Website',
    getURL: () => 'https://example.com/',
  })
  history.attach(contents as never)
  contents.emit('did-navigate', {}, 'https://example.com/')
  contents.emit('page-title-updated', {}, 'Updated title')
  expect(history.search({ text: 'updated' })).toMatchObject([
    { visitCount: 1, title: 'Updated title' },
  ])
  expect(history.visits('https://example.com/')).toMatchObject([
    { transition: 'link', isLocal: true },
  ])
  expect(
    createBrowserHistory('personal', vi.fn<(...args: unknown[]) => void>()).search({ text: '' }),
  ).toEqual([])
  expect(
    createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>()).search({ text: '' }),
  ).toHaveLength(1)
  history.remove('https://example.com/')
  expect(emit).toHaveBeenLastCalledWith('history.onVisitRemoved', {
    allHistory: false,
    urls: ['https://example.com/'],
  })
  history.dispose()
  expect(contents.listenerCount('did-navigate')).toBe(0)
})
it('honors search/range bounds and excludes privileged page schemes', () => {
  vi.useFakeTimers()
  try {
    const history = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
    vi.setSystemTime(1000)
    history.add('https://example.com/a', 'First')
    vi.setSystemTime(2000)
    history.add('https://example.com/a', 'First')
    vi.setSystemTime(3000)
    history.add('http://lan.test/b', 'Second')
    expect(history.search({ text: '', startTime: 0, maxResults: 1 })[0]!.title).toBe('Second')
    history.removeRange(1500, 2500)
    expect(history.visits('https://example.com/a')).toHaveLength(1)
    expect(() => history.add('file:///private')).toThrow('web URLs')
    expect(() => history.add('chrome-extension://test/')).toThrow('web URLs')
    history.clear()
    expect(history.search({ text: '', startTime: 0 })).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})
