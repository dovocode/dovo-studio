import { expect, it } from 'vite-plus/test'
import { runClientEffect } from '@dovo/client-runtime'
import { createDraftStorage } from '../tasks/draft/storage'
import { appendBrowserDraft } from './browser-state'
const selection = {
  text: ' Literal  selection\nSecond line',
  title: 'Source',
  url: 'http://localhost:3000/',
}
function fixture() {
  const values = new Map<string, string>()
  const drafts = createDraftStorage({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value)
    },
    removeItem: async (key) => {
      values.delete(key)
    },
  })
  return { values, drafts }
}
it('preserves queued composer edits and publishes browser quotes through the composer store', async () => {
  const { drafts, values } = fixture()
  const key = 'dovo.draft.runtime.task'
  const published: string[] = []
  const stop = drafts.subscribe(key, (value) => published.push(value))
  const writing = runClientEffect(drafts.writeEffect(key, 'Phone typing ahead of runtime'))
  const appending = runClientEffect(
    drafts.appendEffect(key, appendBrowserDraft('', selection), 'Stale runtime draft'),
  )
  await Promise.all([writing, appending])
  const expected = appendBrowserDraft('Phone typing ahead of runtime', selection)
  expect(await drafts.read(key)).toBe(expected)
  expect(values.get(key)).toBe(expected)
  expect(published.at(-1)).toBe(expected)
  stop()
})
it('seeds an absent phone draft from the runtime and keeps same thread IDs on different computers separate', async () => {
  const { drafts } = fixture()
  await drafts.write('dovo.draft.other.task', 'Other computer draft')
  await runClientEffect(
    drafts.appendEffect(
      'dovo.draft.runtime.task',
      appendBrowserDraft('', { ...selection, text: '' }),
      'Existing runtime draft',
    ),
  )
  expect(await drafts.read('dovo.draft.runtime.task')).toBe(
    appendBrowserDraft('Existing runtime draft', { ...selection, text: '' }),
  )
  expect(await drafts.read('dovo.draft.other.task')).toBe('Other computer draft')
})
it('reports persistence failure after publication without automatically repeating the append', async () => {
  let writes = 0
  const drafts = createDraftStorage({
    getItem: async () => null,
    setItem: async () => {
      writes++
      throw new Error('Disk full')
    },
    removeItem: async () => {},
  })
  await expect(
    runClientEffect(
      drafts.appendEffect('dovo.draft.runtime.task', appendBrowserDraft('', selection), 'Existing'),
    ),
  ).rejects.toThrow('Disk full')
  expect(writes).toBe(1)
  expect(await drafts.read('dovo.draft.runtime.task')).toBe(
    appendBrowserDraft('Existing', selection),
  )
})
