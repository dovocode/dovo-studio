import { expect, it } from 'vite-plus/test'
import {
  mergeThreadWatchEntries,
  sumThreadWatchEntries,
  type ThreadWatchEntry,
  type ThreadWatchSummary,
} from './thread-watches.js'
const entry = (runtimeId: string, threadId: string, pipelines = 1): ThreadWatchEntry => ({
  runtimeId,
  threadId,
  phase: 'needs-input',
  attention: ['question:1'],
  revision: '1',
  watches: { pipelines, pullRequests: 0, failures: 0 },
})
const watch = (
  runtimeId: string,
  threadId: string,
  entries: ThreadWatchEntry[],
): ThreadWatchSummary => ({
  runtimeId,
  threadId,
  computerName: runtimeId,
  relation: 'spawned',
  status: 'watching',
  offline: false,
  snapshot: {
    title: threadId,
    phase: 'needs-input',
    attention: ['question:1'],
    revision: '1',
    entries,
    watches: sumThreadWatchEntries(entries),
  },
})
it('deduplicates diamonds and drops local facts returning through remote cycles', () => {
  const local = entry('A', 'parent', 0),
    b = entry('B', 'child'),
    c = entry('C', 'grandchild')
  const merged = mergeThreadWatchEntries(
    [local],
    [watch('B', 'child', [b, c, entry('A', 'parent', 99)]), watch('C', 'grandchild', [c])],
    'A',
  )
  expect(merged.entries).toEqual([local, b, c])
  expect(sumThreadWatchEntries(merged.entries).pipelines).toBe(2)
})
it('uses the freshest path, ignores stopped/paused watches and preserves offline last-known data', () => {
  const older = { ...watch('B', 'child', [entry('B', 'child', 4)]), lastSuccessAt: '2026-10-18' }
  const newer = {
    ...watch('C', 'child', [entry('B', 'child', 2)]),
    lastSuccessAt: '2026-10-19',
    offline: true,
  }
  const merged = mergeThreadWatchEntries(
    [],
    [
      older,
      newer,
      { ...watch('D', 'stopped', [entry('D', 'stopped')]), status: 'stopped' },
      { ...watch('E', 'paused', [entry('E', 'paused')]), paused: true },
    ],
    'A',
  )
  expect(sumThreadWatchEntries(merged.entries).pipelines).toBe(2)
})
it('supports older snapshot peers and local linked threads', () => {
  const old = watch('B', 'old', [])
  delete old.snapshot!.entries
  old.snapshot!.watches.pipelines = 3
  const merged = mergeThreadWatchEntries(
    [entry('A', 'parent', 0)],
    [old, watch('local', 'linked', [entry('A', 'linked')])],
    'A',
  )
  expect(sumThreadWatchEntries(merged.entries).pipelines).toBe(4)
})
