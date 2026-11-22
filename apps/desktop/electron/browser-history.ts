import { app } from 'electron'
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import { browserProfileIdSchema, isPrivateBrowserProfile } from '@dovo/protocol'
import { damagedBrowserStoreSuffix, readBrowserProfileStore } from './browser-profile-store.js'

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
/** Keep each saved page that is still a valid history item. */
const salvage = (value: unknown): readonly Item[] =>
  Array.isArray(value) ? value.filter((item) => Schema.is(itemSchema)(item)) : []
type Item = Schema.Schema.Type<typeof itemSchema>
export type HistoryItem = Omit<Item, 'visits'>

// Visits and title changes are appended as single journal lines next to the JSON snapshot, so a
// navigation does not rewrite the whole history. Removals append their own entry, then rewrite the
// snapshot and delete the journal. Replaying a journal over a newer snapshot gives the same result:
// a visit already present is skipped, and a removal is applied again after the visits before it.
const journalEntrySchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('visit'),
    id: Schema.String,
    url: Schema.String,
    title: Schema.String,
    transition: Schema.String,
    visitId: Schema.String,
    time: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal('title'), url: Schema.String, title: Schema.String }),
  Schema.Struct({ type: Schema.Literal('remove'), url: Schema.String }),
  Schema.Struct({ type: Schema.Literal('removeRange'), start: Schema.Number, end: Schema.Number }),
  Schema.Struct({ type: Schema.Literal('clear') }),
])
type JournalEntry = Schema.Schema.Type<typeof journalEntrySchema>
const isJournalEntry = Schema.is(journalEntrySchema)
/** Compaction keeps the journal shorter than the 1,000 visits kept per page, so replay never
 * meets a visit that the snapshot already trimmed. */
const MAX_JOURNAL_ENTRIES = 1_000
const journalSuffix = '.journal'

const applyEntry = (items: readonly Item[], entry: JournalEntry): readonly Item[] => {
  switch (entry.type) {
    case 'visit': {
      const index = items.findIndex((item) => item.url === entry.url)
      const previous = index === -1 ? undefined : items[index]
      if (previous?.visits.some((visit) => visit.visitId === entry.visitId)) return items
      const visit = {
        visitId: entry.visitId,
        visitTime: entry.time,
        referringVisitId: '0',
        transition: entry.transition,
        isLocal: true,
      }
      const item: Item = {
        id: previous?.id ?? entry.id,
        url: entry.url,
        title: entry.title || previous?.title || '',
        lastVisitTime: entry.time,
        visitCount: (previous?.visitCount ?? 0) + 1,
        typedCount: (previous?.typedCount ?? 0) + (entry.transition === 'typed' ? 1 : 0),
        visits: [...(previous?.visits ?? []), visit].slice(-1000),
      }
      const next = index === -1 ? [...items] : items.toSpliced(index, 1)
      next.push(item)
      return next.length > 50_000 ? next.slice(-50_000) : next
    }
    case 'title':
      return items.map((item) =>
        item.url === entry.url && item.title !== entry.title
          ? { ...item, title: entry.title }
          : item,
      )
    case 'remove':
      return items.filter((item) => item.url !== entry.url)
    case 'removeRange': {
      const next: Item[] = []
      for (const item of items) {
        const visits = item.visits.filter(
          (visit) => visit.visitTime < entry.start || visit.visitTime >= entry.end,
        )
        if (visits.length === item.visits.length) next.push(item)
        else if (visits.length)
          next.push({
            ...item,
            visits,
            visitCount: visits.length,
            typedCount: visits.filter((v) => v.transition === 'typed').length,
            lastVisitTime: visits.at(-1)!.visitTime,
          })
      }
      return next
    }
    case 'clear':
      return []
  }
}

/**
 * Valid journal entries in order. A line cut off by a crash is skipped. `incomplete` reports a last
 * record without its newline, which the next append must not continue.
 */
const readJournal = (path: string) => {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return { exists: false, entries: [], incomplete: false }
    throw error
  }
  const entries: JournalEntry[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const value: unknown = JSON.parse(line)
      if (isJournalEntry(value)) entries.push(value)
    } catch {
      // An interrupted append leaves a partial last line.
    }
  }
  return { exists: true, entries, incomplete: text !== '' && !text.endsWith('\n') }
}
const unlinkIfPresent = (path: string) => {
  try {
    unlinkSync(path)
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error
  }
}
export const historyURL = (raw: string) => {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Only web URLs can be added to history.')
  return url.href
}
const describe = ({ visits: _visits, ...item }: Item): HistoryItem => item
const historyDirectory = () => join(app.getPath('userData'), 'browser-history')

/** Clear local profile visits without starting extensions in inactive profiles. */
export function clearBrowserHistories(live: ReadonlyMap<string, { clear(): void }>) {
  for (const history of live.values()) history.clear()
  const directory = historyDirectory()
  let files
  try {
    files = readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  for (const file of files) {
    if (!file.isFile()) continue
    // Damaged originals also hold visits, so Clear history removes them for every profile.
    const damaged = file.name.indexOf(`.json${damagedBrowserStoreSuffix}`)
    if (damaged > 0) {
      if (Schema.is(browserProfileIdSchema)(file.name.slice(0, damaged)))
        unlinkSync(join(directory, file.name))
      continue
    }
    // Remove a journal before its snapshot, so an interrupted clear cannot replay visits
    // over an empty profile.
    const store = file.name.endsWith(journalSuffix)
      ? file.name.slice(0, -journalSuffix.length)
      : file.name
    if (!store.endsWith('.json')) continue
    const profileId = store.slice(0, -5)
    if (!Schema.is(browserProfileIdSchema)(profileId) || live.has(profileId)) continue
    unlinkIfPresent(join(directory, `${store}${journalSuffix}`))
    unlinkIfPresent(join(directory, store))
  }
}

/** One store per browser profile. Previews and extension/OAuth pages are never recorded. */
export function createBrowserHistory(
  profileId: string,
  emit: (event: string, value: unknown) => void,
) {
  const directory = historyDirectory()
  const path = join(directory, `${profileId}.json`)
  const journal = `${path}${journalSuffix}`
  const write = (next: readonly Item[]) => {
    mkdirSync(directory, { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 })
    renameSync(temporary, path)
  }
  const persistent = !isPrivateBrowserProfile(profileId)
  let items: readonly Item[] = []
  let journalEntries = 0
  /** The journal's last record has no newline, from a crash or a failed append. */
  let incomplete = false
  /** Write the snapshot, then drop the journal it now contains. */
  const compact = (next: readonly Item[]) => {
    write(next)
    items = next
    unlinkIfPresent(journal)
    journalEntries = 0
    incomplete = false
  }
  /** Append one entry on its own line, after any incomplete record. */
  const append = (entry: JournalEntry) => {
    mkdirSync(directory, { recursive: true })
    try {
      appendFileSync(journal, `${incomplete ? '\n' : ''}${JSON.stringify(entry)}\n`, {
        mode: 0o600,
      })
    } catch (error) {
      // A failed append may have written part of its line.
      incomplete = true
      throw error
    }
    incomplete = false
    journalEntries++
  }
  let journalFound = false
  if (persistent) {
    try {
      items =
        readBrowserProfileStore(path, Schema.decodeUnknownSync(storeSchema), salvage, write) ?? []
      const read = readJournal(journal)
      for (const entry of read.entries) items = applyEntry(items, entry)
      journalEntries = read.entries.length
      incomplete = read.incomplete
      journalFound = read.exists
    } catch (error) {
      throw new Error('Browser history could not be read.', { cause: error })
    }
    // Compact any journal, including one that holds only a torn record.
    if (journalFound)
      try {
        compact(items)
      } catch (error) {
        // The journal stays; the next compaction or launch tries again.
        console.error('Could not compact browser history.', error)
      }
  }
  /** Journal a visit or title change. Memory changes only after the line is written. */
  const journalChange = (entry: JournalEntry) => {
    const next = applyEntry(items, entry)
    if (persistent) append(entry)
    items = next
    if (persistent && journalEntries >= MAX_JOURNAL_ENTRIES)
      try {
        compact(items)
      } catch (error) {
        console.error('Could not compact browser history.', error)
      }
  }
  /**
   * Remove history from disk now. The removal is journaled first: if the process stops after the
   * snapshot is written, replay re-applies it after the older visits in the journal.
   */
  const remove = (entry: JournalEntry) => {
    const next = applyEntry(items, entry)
    if (persistent) {
      if (journalEntries) {
        append(entry)
        items = next
      }
      compact(next)
    }
    items = next
  }
  const add = (raw: string, title = '', transition = 'link') => {
    const url = historyURL(raw)
    journalChange({
      type: 'visit',
      id: randomUUID(),
      url,
      title,
      transition,
      visitId: randomUUID(),
      time: Date.now(),
    })
    emit('history.onVisited', describe(items.at(-1)!))
  }
  const removeRange = (start: number, end: number) => {
    const before = new Set(items.map((item) => item.url))
    remove({ type: 'removeRange', start, end })
    for (const item of items) before.delete(item.url)
    emit('history.onVisitRemoved', { allHistory: false, urls: [...before] })
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
      remove({ type: 'remove', url })
      emit('history.onVisitRemoved', { allHistory: false, urls: [url] })
    },
    removeRange,
    clear() {
      remove({ type: 'clear' })
      emit('history.onVisitRemoved', { allHistory: true, urls: [] })
    },
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
            journalChange({ type: 'title', url: item.url, title: value })
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
