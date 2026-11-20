import { expect, it } from 'vite-plus/test'
import {
  decode,
  runtimeProfile,
  snapshotSchema,
  taskNotificationEvents,
  taskNotificationStates,
  type RuntimeOverview,
  type TaskState,
} from '@dovo/protocol'
import {
  delegatedNoticeInputId,
  noticeHref,
  noticeReturnRoute,
  sameNoticeThread,
  noticeVisible,
  reconcileInputNotices,
  type InAppInputNotice,
} from './in-app-notices'
import { notificationRemoteInput } from './target'
import { deliverInAppNotification, registerInAppNotification } from './in-app-delivery'
import {
  blockAccessibleNotificationInputs,
  registerAccessibleNotificationInput,
  subscribeAccessibleNotificationInputs,
} from './visibility'

const target = { runtimeId: 'one', viewId: 'tasks' as const, entityId: 'thread' }
const key = JSON.stringify(['one', 'thread'])
const id = JSON.stringify(['approval', 'review'])
const state = (inputIds: string[]): TaskState => ({
  target,
  title: 'Thread',
  inputIds,
  running: true,
  needsInput: inputIds.length > 0,
  failed: false,
})
const states = (ids: string[]) => new Map([[key, state(ids)]])
const events = taskNotificationEvents(states([]), states([id]))

it('queues each new request and hides it only while its exact card is visible', () => {
  const notices = reconcileInputNotices([], states([id]), events)
  expect(notices).toHaveLength(1)
  expect(notices[0]).toMatchObject({ target, inputId: id, confirmed: true })
  // An open thread is not enough. The card for this request must be on screen.
  expect(reconcileInputNotices([], states([id]), events)).toEqual(notices)
  const remove = registerAccessibleNotificationInput({
    runtimeId: 'one',
    taskId: 'thread',
    inputId: 'review',
    inputType: 'approval',
  })
  try {
    expect(reconcileInputNotices([], states([id]), events)).toEqual([])
    // Another computer's card with the same IDs does not hide this request.
    expect(noticeVisible({ target: { ...target, runtimeId: 'two' }, inputId: id })).toBe(false)
    // A sheet over the card hides it again.
    const unblock = blockAccessibleNotificationInputs()
    expect(reconcileInputNotices([], states([id]), events)).toEqual(notices)
    unblock()
  } finally {
    remove()
  }
  expect(reconcileInputNotices(notices, states([id]), events)).toEqual(notices)
})

it('keeps a second request in the open thread and opens its exact card', () => {
  const second = JSON.stringify(['question', 'second'])
  const remove = registerAccessibleNotificationInput({
    runtimeId: 'one',
    taskId: 'thread',
    inputId: 'first',
    inputType: 'question',
  })
  const changes: number[] = []
  const unsubscribe = subscribeAccessibleNotificationInputs(() => changes.push(changes.length))
  try {
    const notices = reconcileInputNotices(
      [],
      states([second]),
      taskNotificationEvents(states([]), states([second])),
    )
    // The first question's card is on screen, but the second request has no visible card.
    expect(notices).toHaveLength(1)
    expect(noticeVisible(notices[0]!)).toBe(false)
    const sources = { profiles: [], overviews: [] }
    expect(noticeHref(notices[0]!, sources).params).toEqual({
      runtimeId: 'one',
      taskId: 'thread',
      questionId: 'second',
    })
    expect(noticeHref({ target, inputId: id }, sources).params).toEqual({
      runtimeId: 'one',
      taskId: 'thread',
      approvalId: 'review',
    })
    expect(noticeHref({ target }, sources).params).toEqual({ runtimeId: 'one', taskId: 'thread' })
  } finally {
    remove()
    unsubscribe()
  }
  expect(changes).toEqual([0])
})

it('clears only resolved requests, retaining a second request for the same thread', () => {
  const next = JSON.stringify(['question', 'next'])
  const notices = reconcileInputNotices(
    [],
    states([id, next]),
    taskNotificationEvents(states([]), states([id, next])),
  )
  expect(notices).toHaveLength(2)
  expect(reconcileInputNotices(notices, states([next]), [])).toEqual([notices[1]])
  expect(reconcileInputNotices(notices, states([]), [])).toEqual([])
  expect(reconcileInputNotices(notices, new Map(), [])).toEqual([])
})

it('deduplicates push and live updates while allowing a push to arrive before the snapshot', () => {
  const push: InAppInputNotice = { ...events[0]!, confirmed: false }
  expect(reconcileInputNotices([push], states([]), [])).toEqual([push])
  const confirmed = reconcileInputNotices([push], states([id]), events)
  expect(confirmed).toHaveLength(1)
  expect(confirmed[0]?.confirmed).toBe(true)
  expect(reconcileInputNotices(confirmed, states([]), [])).toEqual([])
})

it('never replays old requests after reconnect or queues completion notices', () => {
  expect(taskNotificationEvents(new Map(), states([id]))).toEqual([])
  const completed = taskNotificationEvents(
    states([]),
    new Map([[key, { ...state([]), running: false }]]),
  )
  expect(reconcileInputNotices([], states([]), completed)).toEqual([])
})

it('bounds queued requests without changing the order of retained requests', () => {
  const notices = Array.from({ length: 60 }, (_, index) => ({
    key: String(index),
    title: 'Thread',
    target,
    confirmed: false,
  }))
  expect(reconcileInputNotices(notices, states([]), [])).toEqual(notices.slice(-50))
})

it('keeps native push as fallback for invalid, background or unhandled notifications', () => {
  const data = {
    kind: 'input',
    runtimeId: 'one',
    taskId: 'thread',
    inputId: 'q',
    inputType: 'question',
  }
  expect(deliverInAppNotification(data, true)).toBe(false)
  const seen: unknown[] = []
  const remove = registerInAppNotification((target) => {
    seen.push(target)
    return true
  })
  try {
    for (const invalid of [
      null,
      {},
      { ...data, kind: 'done' },
      { ...data, inputId: '' },
      { ...data, inputType: 'other' },
    ])
      expect(deliverInAppNotification(invalid, true)).toBe(false)
    expect(deliverInAppNotification(data, false)).toBe(false)
    expect(seen).toEqual([])
    expect(deliverInAppNotification(data, true)).toBe(true)
    expect(seen).toEqual([
      { runtimeId: 'one', taskId: 'thread', inputId: 'q', inputType: 'question' },
    ])
  } finally {
    remove()
  }
  expect(deliverInAppNotification(data, true)).toBe(false)
})

it('hides a delegated child request while its card shows in the parent or child thread', () => {
  // The runtime notifies a child's request on its parent thread.
  const parent = { ...target, entityId: 'parent' }
  for (const [inputType, inputId] of [
    ['question', 'question'],
    ['approval', 'review'],
  ] as const) {
    const notice = { target: parent, inputId: JSON.stringify([inputType, inputId]) }
    expect(noticeVisible(notice)).toBe(false)
    // The card in the child or parent registers the child as asker and the parent as owner.
    const remove = registerAccessibleNotificationInput({
      runtimeId: 'one',
      taskId: 'child',
      ownerTaskId: 'parent',
      inputId,
      inputType,
    })
    expect(noticeVisible(notice)).toBe(true)
    // Another computer cannot show this computer's request.
    expect(noticeVisible({ ...notice, target: { ...parent, runtimeId: 'two' } })).toBe(false)
    remove()
  }
  const pending: InAppInputNotice = {
    key: 'child-question',
    title: 'Parent',
    target: parent,
    inputId: JSON.stringify(['question', 'question']),
    confirmed: false,
  }
  const remove = registerAccessibleNotificationInput({
    runtimeId: 'one',
    taskId: 'child',
    ownerTaskId: 'parent',
    inputId: 'question',
    inputType: 'question',
  })
  expect(reconcileInputNotices([pending], new Map(), [])).toEqual([])
  remove()
})

it('gives a push for a child on another computer its live identity and hides it in that child', () => {
  const profile = runtimeProfile(
    { address: 'http://parent.lan:8787', token: 'parent-notification-device-token' },
    'P',
  )
  const input = {
    id: 'question',
    runtimeId: 'child-identity',
    taskId: 'child',
    threadTitle: 'Worker',
    title: 'Pick one',
    kind: 'question' as const,
  }
  const task = {
    id: 'parent',
    title: 'Parent',
    repositoryId: '',
    agentId: '',
    status: 'running',
    createdAt: '',
    draft: '',
    files: [],
    messages: [],
    example: false,
    threadWatches: [
      {
        runtimeId: 'child-profile',
        threadId: 'child',
        computerName: 'Child',
        relation: 'spawned',
        delegated: true,
        status: 'watching',
        offline: false,
        snapshot: {
          runtimeId: 'child-identity',
          title: 'Worker',
          revision: '1',
          phase: 'needs-input',
          attention: ['question'],
          watches: { pipelines: 0, pullRequests: 0, failures: 0 },
          humanInputs: [input],
        },
      },
    ],
  }
  const parentSnapshot = decode(snapshotSchema, {
    revision: 1,
    owner: false,
    workspace: {
      version: 1,
      runtimeAddress: '',
      agents: [],
      automations: [],
      repositories: [],
      tasks: [task],
    },
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  })
  const overview: RuntimeOverview = {
    profile,
    snapshot: parentSnapshot,
    connected: true,
    error: null,
    lastSeen: '',
    pulls: null,
    pullError: null,
  }
  // The parent push names the child's request as `identity:id`.
  const remote = notificationRemoteInput(
    { runtimeId: profile.id, taskId: 'parent', inputId: 'child-identity:question' },
    [overview],
  )
  expect(remote).toBeDefined()
  const inputId = delegatedNoticeInputId(remote!)
  const live = taskNotificationStates([overview]).get(JSON.stringify([profile.id, 'parent']))
  expect(live?.inputIds).toEqual([inputId])
  const notice = {
    target: { runtimeId: profile.id, viewId: 'tasks' as const, entityId: 'parent' },
    inputId,
  }
  expect(noticeVisible(notice)).toBe(false)
  // The child's card registers its own computer identity.
  const childCard = (runtimeIdentity: string) =>
    registerAccessibleNotificationInput({
      runtimeId: 'child-profile',
      taskId: 'child',
      runtimeIdentity,
      inputId: 'question',
      inputType: 'question',
    })
  let remove = childCard('child-identity')
  expect(noticeVisible(notice)).toBe(true)
  remove()
  remove = childCard('other')
  expect(noticeVisible(notice)).toBe(false)
  remove()
  // Opening the banner goes to the child's request on its own computer. The banner names the
  // parent, so "Return to" must follow the thread that actually opened, not the notice target.
  const interrupted = { runtimeId: profile.id, taskId: 'other', approvalId: 'review' }
  const opened = noticeHref(notice, { profiles: [profile], overviews: [overview] })
  expect(opened.params).toMatchObject({ runtimeId: 'child-profile', taskId: 'child' })
  const viaChild = noticeReturnRoute(interrupted, opened, 'Thread')
  const childThread = { runtimeId: 'child-profile', viewId: 'tasks' as const, entityId: 'child' }
  expect(sameNoticeThread(notice.target, childThread)).toBe(false)
  expect(sameNoticeThread(viaChild.destination, childThread)).toBe(true)
  expect(viaChild.href.params).toEqual(interrupted)

  // When the phone is also paired with the owning computer, the banner opens the question there.
  const owner = {
    id: 'owner-profile',
    connection: { address: 'http://child.lan:8787', token: 'owner', runtimeId: 'child-identity' },
  }
  const ownerOverview = {
    profile: owner,
    snapshot: {
      runtimeId: 'child-identity',
      questions: [{ id: 'question', taskId: 'child' }],
      workspace: { tasks: [{ id: 'child' }] },
    },
  }
  const sources = { profiles: [profile, owner], overviews: [overview, ownerOverview] }
  const ownerOpened = noticeHref(notice, sources)
  expect(ownerOpened.params).toEqual({
    runtimeId: 'owner-profile',
    taskId: 'child',
    questionId: 'question',
    runtimeIdentity: 'child-identity',
  })
  const viaOwner = noticeReturnRoute(interrupted, ownerOpened, 'Thread')
  const ownerThread = { runtimeId: 'owner-profile', viewId: 'tasks' as const, entityId: 'child' }
  expect(sameNoticeThread(viaOwner.destination, ownerThread)).toBe(true)
  expect(sameNoticeThread(viaOwner.destination, notice.target)).toBe(false)
  expect(viaOwner.href.params).toEqual(interrupted)
})

it('returns from a banner to the interrupted request, parent and native agent', () => {
  // The user reviews an approval in a child thread that was opened from its parent.
  const interrupted = {
    runtimeId: 'one',
    taskId: 'child',
    approvalId: 'review',
    questionId: 'question',
    runtimeIdentity: 'one-identity',
    nativeAgentKey: 'agent',
    parentRuntimeId: 'one',
    parentRuntimeIdentity: 'one-identity',
    parentTaskId: 'parent',
    parentTitle: 'Plan',
  }
  // A banner for a delegated child's request opens that child on its own computer.
  const opened = noticeHref(
    { target: { ...target, runtimeId: 'one', entityId: 'other' }, inputId: id },
    { profiles: [], overviews: [] },
  )
  const route = noticeReturnRoute(interrupted, opened, 'Thread')
  expect(route.href.params).toEqual(interrupted)
  // "Return to" shows in the thread the banner opened.
  expect(route.destination).toEqual({ runtimeId: 'one', viewId: 'tasks', entityId: 'other' })
  const remote = noticeReturnRoute(
    interrupted,
    { ...opened, params: { runtimeId: 'child-profile', taskId: 'remote-child' } },
    'Thread',
  )
  expect(remote.destination).toEqual({
    runtimeId: 'child-profile',
    viewId: 'tasks',
    entityId: 'remote-child',
  })
})
