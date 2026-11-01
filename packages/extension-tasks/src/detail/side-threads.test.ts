import { expect, it } from 'vite-plus/test'
import type { Task } from '@dovo/protocol'
import {
  appendHandoff,
  bringBackIssue,
  forgetSideChatBeside,
  handoffApplied,
  recordHandoff,
  recordSideChatBeside,
  sideChatBeside,
  sideThreadOf,
  sideThreadProvenance,
  sideThreadsOf,
  unusedSideDraft,
} from './side-threads'

const thread = (id: string, fields: Record<string, unknown> = {}) =>
  ({
    id,
    createdAt: '2026-10-31T10:00:00Z',
    status: 'review',
    messages: [{ id: `${id}-answer`, role: 'assistant', text: 'Done' }],
    turns: [{ id: `${id}-turn`, status: 'completed', assistantId: `${id}-answer` }],
    ...fields,
  }) as unknown as Task

it('lists only side threads that name the parent, ignoring self links', () => {
  const tasks = [
    thread('parent'),
    thread('old', { sideThread: { parentTaskId: 'parent' } }),
    thread('new', { sideThread: { parentTaskId: 'parent' }, createdAt: '2026-10-31T11:00:00Z' }),
    thread('archived', {
      sideThread: { parentTaskId: 'parent' },
      createdAt: '2026-10-31T12:00:00Z',
      archivedAt: '2026-10-31T12:30:00Z',
    }),
    thread('other', { sideThread: { parentTaskId: 'elsewhere' } }),
    thread('self', { sideThread: { parentTaskId: 'self' } }),
  ]
  expect(sideThreadsOf(tasks, 'parent').map((task) => task.id)).toEqual(['new', 'old', 'archived'])
  expect(sideThreadOf(tasks[5]!)).toBeUndefined()
})

it('explains when results cannot be brought back yet', () => {
  const parent = thread('parent')
  expect(bringBackIssue(thread('child'), parent)).toBe('')
  expect(bringBackIssue(thread('child'), undefined)).toMatch(/not available/)
  expect(bringBackIssue(thread('child', { status: 'draft', turns: [] }), parent)).toMatch(
    /Complete a turn in the side chat/,
  )
  expect(
    bringBackIssue(thread('child', { turns: [{ id: 'failed', status: 'failed' }] }), parent),
  ).toMatch(/Complete a turn in the side chat/)
  expect(bringBackIssue(thread('child', { status: 'failed' }), parent)).toMatch(/Complete/)
  expect(bringBackIssue(thread('child', { archived: true }), parent)).toBe('')
  expect(bringBackIssue(thread('child', { archivedAt: '2026-10-31T00:00:00Z' }), parent)).toMatch(
    /Restore this/,
  )
  expect(bringBackIssue(thread('child'), thread('parent', { archived: true }))).toBe('')
  expect(bringBackIssue(thread('child', { status: 'running' }), parent)).toMatch(/finish/)
  expect(bringBackIssue(thread('child'), thread('parent', { queue: [{ id: 'q' }] }))).toMatch(
    /parent thread to finish/,
  )
  expect(
    bringBackIssue(thread('child'), thread('parent', { archivedAt: '2026-10-31T00:00:00Z' })),
  ).toMatch(/Restore/)
  expect(
    bringBackIssue(
      thread('child', {
        sideThread: { parentTaskId: 'parent', broughtBackThrough: 'child-turn' },
      }),
      parent,
    ),
  ).toBe('')
})

it('appends an exact handoff once while keeping local edits', () => {
  const handoff = '[Side thread: Cache (child), completed turn t1]\nCache is fine'
  expect(appendHandoff('', handoff)).toBe(handoff)
  const appended = appendHandoff('Unsaved local edit  \n', handoff)
  expect(appended).toBe(`Unsaved local edit\n\n${handoff}`)
  // A retry, or the runtime's own copy hydrating first, leaves the draft unchanged.
  expect(appendHandoff(appended, handoff)).toBe(appended)
  expect(appendHandoff(`${handoff}\n\nTyped after`, handoff)).toBe(`${handoff}\n\nTyped after`)
  expect(appendHandoff('Draft', '  ')).toBe('Draft')
})

function withStorage(run: (values: Map<string, string>) => void) {
  const values = new Map<string, string>()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  })
  try {
    run(values)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

it('remembers applied receipts per parent thread across reloads', () => {
  withStorage((values) => {
    expect(handoffApplied('mac:parent', 'receipt')).toBe(false)
    recordHandoff('mac:parent', 'receipt')
    recordHandoff('mac:parent', 'receipt')
    expect(handoffApplied('mac:parent', 'receipt')).toBe(true)
    expect(handoffApplied('mac:other', 'receipt')).toBe(false)
    expect(JSON.parse(values.get('dovo.sideChatHandoffReceipts')!)).toHaveLength(1)
    for (let index = 0; index < 250; index++) recordHandoff('mac:parent', `r${index}`)
    expect(JSON.parse(values.get('dovo.sideChatHandoffReceipts')!)).toHaveLength(200)
    // Storage written by an earlier session is honoured; broken storage is ignored safely.
    values.set('dovo.sideChatHandoffReceipts', JSON.stringify([JSON.stringify(['mac:old', 'x'])]))
    expect(handoffApplied('mac:old', 'x')).toBe(true)
    values.set('dovo.sideChatHandoffReceipts', '{broken')
    expect(handoffApplied('mac:old', 'x')).toBe(false)
    // Receipts applied in this session still count when storage is unreadable.
    expect(handoffApplied('mac:parent', 'r249')).toBe(true)
  })
})

it('requires a completed turn of the side chat itself, not inherited parent history', () => {
  const parent = thread('parent')
  const inherited = [
    { id: 'p1', role: 'user', text: 'Build it' },
    { id: 'p2', role: 'assistant', text: 'Built' },
  ]
  const link = { parentTaskId: 'parent', contextMessageCount: 2 }
  // Copied parent answers, even with a completed turn pointing at them, are not a result.
  for (const turns of [[], [{ id: 'parent-turn', status: 'completed', assistantId: 'p2' }]])
    expect(
      bringBackIssue(thread('child', { messages: inherited, turns, sideThread: link }), parent),
    ).toMatch(/Complete a turn in the side chat/)
  const own = thread('child', {
    messages: [
      ...inherited,
      { id: 'c1', role: 'user', text: 'Check it' },
      { id: 'c2', role: 'assistant', text: 'Checked' },
    ],
    turns: [{ id: 'own', status: 'completed', assistantId: 'c2' }],
    sideThread: link,
  })
  expect(bringBackIssue(own, parent)).toBe('')
  expect(
    bringBackIssue({ ...own, sideThread: { ...link, broughtBackThrough: 'own' } } as Task, parent),
  ).toBe('')
  // A later turn that is still missing its answer does not fall back to an earlier one.
  expect(
    bringBackIssue(
      {
        ...own,
        turns: [...own.turns!, { id: 'next', status: 'completed', assistantId: 'gone' }],
      } as Task,
      parent,
    ),
  ).toMatch(/Complete a turn/)
})

it('describes where side chat files and conversation came from', () => {
  const active = sideThreadProvenance({ source: 'head', contextMessageCount: 3 })
  expect(active.partial).toBe(true)
  expect(active.files).toMatch(/uncommitted changes are not included/)
  expect(active.context).toMatch(/copy of 3 parent messages/)
  const idle = sideThreadProvenance({ source: 'snapshot', contextMessageCount: 1 })
  expect(idle.partial).toBe(false)
  expect(idle.files).toMatch(/including its uncommitted changes/)
  expect(idle.context).toMatch(/copy of 1 parent message;/)
  expect(sideThreadProvenance({ source: 'scratch', contextMessageCount: 0 }).context).toMatch(
    /without the parent/,
  )
  // Only exceptional sources need a note beside each view.
  expect(active.note).toBe('Committed files only')
  expect(sideThreadProvenance({ source: 'scratch', contextMessageCount: 0 }).note).toBe(
    'Separate directory',
  )
  expect(idle.note).toBeUndefined()
  expect(
    sideThreadProvenance({ source: 'checkpoint', contextMessageCount: 1 }).note,
  ).toBeUndefined()
})

it('treats only never-started side chat drafts as unused', () => {
  const link = { parentTaskId: 'parent', contextMessageCount: 2 }
  const inherited = [
    { id: 'p1', role: 'user', text: 'Build it' },
    { id: 'p2', role: 'assistant', text: 'Built' },
  ]
  const draft = thread('child', {
    status: 'draft',
    turns: [],
    messages: inherited,
    sideThread: link,
  })
  expect(unusedSideDraft(draft)).toBe(true)
  expect(unusedSideDraft({ ...draft, sideThread: undefined } as Task)).toBe(false)
  expect(unusedSideDraft({ ...draft, status: 'running' } as Task)).toBe(false)
  expect(unusedSideDraft({ ...draft, queue: [{ id: 'q' }] } as unknown as Task)).toBe(false)
  expect(unusedSideDraft({ ...draft, turns: [{ id: 't', status: 'failed' }] } as Task)).toBe(false)
  expect(
    unusedSideDraft({
      ...draft,
      messages: [...inherited, { id: 'c1', role: 'user', text: 'Asked' }],
    } as Task),
  ).toBe(false)
})

it('pairs a side chat with its parent per runtime, surviving reloads', () => {
  withStorage((values) => {
    const parent = JSON.stringify(['mac', 'parent'])
    expect(sideChatBeside(parent, 'runtime-a')).toBeUndefined()
    recordSideChatBeside(parent, 'runtime-a', 'child')
    expect(sideChatBeside(parent, 'runtime-a')).toBe('child')
    // Another runtime profile, or a profile now pointing at another computer, does not restore it.
    expect(sideChatBeside(JSON.stringify(['linux', 'parent']), 'runtime-a')).toBeUndefined()
    expect(sideChatBeside(parent, 'runtime-b')).toBeUndefined()
    // The identity is unknown while the snapshot loads.
    expect(sideChatBeside(parent, undefined)).toBe('child')
    recordSideChatBeside(parent, 'runtime-a', 'other-child')
    expect(sideChatBeside(parent, 'runtime-a')).toBe('other-child')
    expect(JSON.parse(values.get('dovo.sideChatBeside')!)).toEqual([
      { parent, identity: 'runtime-a', child: 'other-child' },
    ])
    forgetSideChatBeside(parent)
    expect(sideChatBeside(parent, 'runtime-a')).toBeUndefined()
    expect(JSON.parse(values.get('dovo.sideChatBeside')!)).toEqual([])
    // Entries from an earlier session are honoured; broken storage is ignored safely.
    const earlier = JSON.stringify(['mac', 'earlier'])
    values.set('dovo.sideChatBeside', JSON.stringify([{ parent: earlier, child: 'kept' }, 7]))
    expect(sideChatBeside(earlier, 'runtime-a')).toBe('kept')
    values.set('dovo.sideChatBeside', '{broken')
    expect(sideChatBeside(JSON.stringify(['mac', 'missing']), undefined)).toBeUndefined()
    for (let index = 0; index < 120; index++)
      recordSideChatBeside(JSON.stringify(['mac', `p${index}`]), undefined, `c${index}`)
    expect(JSON.parse(values.get('dovo.sideChatBeside')!)).toHaveLength(100)
  })
})
