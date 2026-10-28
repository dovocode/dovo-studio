import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import { isPrivateBrowserProfile } from '@dovo/protocol'

const visitSchema = Schema.Struct({
  visitId: Schema.String,
  visitTime: Schema.Number,
  referringVisitId: Schema.String,
  transition: Schema.String,
  isLocal: Schema.Boolean,
})
const itemSchema = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  title: Schema.String,
  lastVisitTime: Schema.Number,
  visitCount: Schema.Number,
  typedCount: Schema.Number,
  visits: Schema.Array(visitSchema),
})
const storeSchema = Schema.Array(itemSchema)
type Item = Schema.Schema.Type<typeof itemSchema>
export type HistoryItem = Omit<Item, 'visits'>
export const historyURL = (raw: string) => {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Only web URLs can be added to history.')
  return url.href
}
const describe = ({ visits: _visits, ...item }: Item): HistoryItem => item

/** One store per browser profile. Previews and extension/OAuth pages are never recorded. */
export function createBrowserHistory(
  profileId: string,
  emit: (event: string, value: unknown) => void,
) {
  const directory = join(app.getPath('userData'), 'browser-history')
  const path = join(directory, `${profileId}.json`)
  let items: readonly Item[] = []
  if (!isPrivateBrowserProfile(profileId)) {
    try {
      items = Schema.decodeUnknownSync(storeSchema)(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
        throw new Error('Browser history could not be read.')
    }
  }
  const save = (next: readonly Item[]) => {
    if (!isPrivateBrowserProfile(profileId)) {
      mkdirSync(directory, { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 })
      renameSync(temporary, path)
    }
    items = next
  }
  const add = (raw: string, title = '', transition = 'link') => {
    const url = historyURL(raw)
    const previous = items.find((item) => item.url === url)
    const time = Date.now()
    const visit = {
      visitId: randomUUID(),
      visitTime: time,
      referringVisitId: '0',
      transition,
      isLocal: true,
    }
    const item: Item = {
      id: previous?.id ?? randomUUID(),
      url,
      title: title || previous?.title || '',
      lastVisitTime: time,
      visitCount: (previous?.visitCount ?? 0) + 1,
      typedCount: (previous?.typedCount ?? 0) + (transition === 'typed' ? 1 : 0),
      visits: [...(previous?.visits ?? []), visit].slice(-1000),
    }
    save([...items.filter((item) => item.url !== url), item].slice(-50_000))
    emit('history.onVisited', describe(item))
  }
  const removeRange = (start: number, end: number, allHistory = false) => {
    const removed: string[] = []
    const next: Item[] = []
    for (const item of items) {
      const visits = item.visits.filter(
        (visit) => visit.visitTime < start || visit.visitTime >= end,
      )
      if (visits.length === item.visits.length) {
        next.push(item)
        continue
      }
      if (!visits.length) removed.push(item.url)
      else
        next.push({
          ...item,
          visits,
          visitCount: visits.length,
          typedCount: visits.filter((v) => v.transition === 'typed').length,
          lastVisitTime: visits.at(-1)!.visitTime,
        })
    }
    save(next)
    emit('history.onVisitRemoved', { allHistory, urls: removed })
  }
  const tracked = new Map<Electron.WebContents, () => void>()
  return {
    add,
    search(query: { text: string; startTime?: number; endTime?: number; maxResults?: number }) {
      const text = query.text.toLowerCase()
      return items
        .filter(
          (item) =>
            item.lastVisitTime >= (query.startTime ?? Date.now() - 86400_000) &&
            item.lastVisitTime <= (query.endTime ?? Infinity) &&
            `${item.title}\n${item.url}`.toLowerCase().includes(text),
        )
        .toSorted((a, b) => b.lastVisitTime - a.lastVisitTime)
        .slice(0, query.maxResults ?? 100)
        .map(describe)
    },
    visits(raw: string) {
      const item = items.find((item) => item.url === historyURL(raw))
      return item?.visits.map((visit) => ({ ...visit, id: item.id })) ?? []
    },
    remove(raw: string) {
      const url = historyURL(raw)
      save(items.filter((item) => item.url !== url))
      emit('history.onVisitRemoved', { allHistory: false, urls: [url] })
    },
    removeRange,
    clear: () => removeRange(-Infinity, Infinity, true),
    attach(contents: Electron.WebContents) {
      if (tracked.has(contents)) return
      const record = (_event: Electron.Event, url: string) => {
        if (!/^https?:/.test(url)) return
        try {
          add(url, contents.getTitle())
        } catch (error) {
          console.error('Could not save browser history.', error)
        }
      }
      const inPage = (event: Electron.Event, url: string, main: boolean) => {
        if (main) record(event, url)
      }
      const title = (_event: Electron.Event, value: string) => {
        const item = items.find((item) => item.url === contents.getURL())
        if (item && item.title !== value) {
          try {
            save(items.map((entry) => (entry === item ? { ...item, title: value } : entry)))
          } catch (error) {
            console.error('Could not save browser history title.', error)
          }
        }
      }
      contents.on('did-navigate', record)
      contents.on('did-navigate-in-page', inPage)
      contents.on('page-title-updated', title)
      const detach = () => {
        contents.off('did-navigate', record)
        contents.off('did-navigate-in-page', inPage)
        contents.off('page-title-updated', title)
        tracked.delete(contents)
      }
      contents.once('destroyed', detach)
      tracked.set(contents, detach)
    },
    detach(contents: Electron.WebContents) {
      tracked.get(contents)?.()
    },
    dispose() {
      for (const detach of tracked.values()) detach()
    },
  }
}
