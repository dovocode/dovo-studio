import { expect, it } from 'vite-plus/test'
import type { Task } from '@dovo/protocol'
import { notificationTarget, notificationHref } from './target'
it('opens the exact question on its owning computer, keeping legacy task notifications compatible', () => {
  const target = notificationTarget({
    runtimeId: 'computer-b',
    taskId: 'shared-id',
    inputId: 'question-2',
    inputType: 'question',
  })
  expect(target).not.toBeNull()
  expect(target && notificationHref(target)).toEqual({
    pathname: '/(tasks)/thread/[runtimeId]/[taskId]',
    params: { runtimeId: 'computer-b', taskId: 'shared-id', questionId: 'question-2' },
  })
  expect(notificationHref({ runtimeId: 'computer-a', taskId: 'shared-id' }).params).toEqual({
    runtimeId: 'computer-a',
    taskId: 'shared-id',
  })
  // The system route keeps a local approval's ID, so the thread shows that exact request.
  expect(
    notificationHref({
      runtimeId: 'computer-a',
      taskId: 'shared-id',
      inputType: 'approval',
      inputId: 'approval',
    }).params,
  ).toEqual({ runtimeId: 'computer-a', taskId: 'shared-id', approvalId: 'approval' })
})
it('rejects malformed or incomplete notification identities', () => {
  expect(
    notificationTarget({ runtimeId: 'host', taskId: 'task', inputType: 'question' }),
  ).toBeNull()
  for (const data of [
    undefined,
    {},
    { runtimeId: '', taskId: 'task' },
    { runtimeId: 'host', taskId: 'task', inputId: '' },
  ])
    expect(notificationTarget(data)).toBeNull()
})
it('does not navigate to a fake thread when opening a test notification', () => {
  expect(
    notificationTarget({ runtimeId: 'computer', taskId: 'dovo-notification-test', kind: 'done' }),
  ).toBeNull()
})

it('opens a delegated child question on its owning computer instead of the parent', () => {
  const watch: NonNullable<Task['threadWatches']>[number] = {
    runtimeId: 'child-profile',
    threadId: 'child-thread',
    computerName: 'Desktop',
    relation: 'spawned',
    delegated: true,
    status: 'watching',
    offline: false,
    snapshot: {
      runtimeId: 'child-identity',
      title: 'Child',
      revision: '1',
      phase: 'needs-input',
      attention: ['question-1'],
      watches: { pipelines: 0, pullRequests: 0, failures: 0 },
      humanInputs: [
        {
          id: 'question-1',
          runtimeId: 'child-identity',
          taskId: 'child-thread',
          threadTitle: 'Worker',
          title: 'Pick one',
          kind: 'question',
        },
      ],
    },
  }
  const parent = { id: 'parent-thread', threadWatches: [watch] }
  const profiles = [
    { id: 'parent-profile', connection: { runtimeId: 'parent-identity' } },
    { id: 'child-profile', connection: { runtimeId: 'child-identity' } },
  ]
  const overviews = [
    {
      profile: { id: 'parent-profile' },
      snapshot: { runtimeId: 'parent-identity', questions: [], workspace: { tasks: [parent] } },
    },
    {
      profile: { id: 'child-profile' },
      snapshot: {
        runtimeId: 'child-identity',
        questions: [{ id: 'question-1', taskId: 'child-thread' }],
        workspace: { tasks: [] },
      },
    },
  ]
  // The runtime pushes the parent task with a composite `identity:id` input.
  const target = notificationTarget({
    runtimeId: 'parent-profile',
    taskId: 'parent-thread',
    kind: 'input',
    inputId: 'child-identity:question-1',
    inputType: 'question',
  })
  expect(target && notificationHref(target, { profiles, overviews }).params).toEqual({
    runtimeId: 'child-profile',
    taskId: 'child-thread',
    runtimeIdentity: 'child-identity',
    questionId: 'question-1',
  })
  // The owner is paired, but its snapshot is stale or not loaded yet. The exact ID still goes to the
  // owner, whose question card shows that request or its closed status.
  const exact = {
    runtimeId: 'child-profile',
    taskId: 'child-thread',
    runtimeIdentity: 'child-identity',
    questionId: 'question-1',
  }
  const owner = overviews[1]!
  for (const ownerOverviews of [
    [overviews[0]!],
    [overviews[0]!, { ...owner, snapshot: null }],
    [
      overviews[0]!,
      {
        ...owner,
        snapshot: {
          ...owner.snapshot,
          questions: [{ id: 'question-2', taskId: 'child-thread' }],
        },
      },
    ],
  ])
    expect(
      target && notificationHref(target, { profiles, overviews: ownerOverviews }).params,
    ).toEqual(exact)
  // A delegated approval keeps its exact ID the same way.
  const approvalWatch: NonNullable<Task['threadWatches']>[number] = {
    ...watch,
    snapshot: {
      runtimeId: 'child-identity',
      title: 'Child',
      revision: '1',
      phase: 'needs-input',
      attention: ['approval-1'],
      watches: { pipelines: 0, pullRequests: 0, failures: 0 },
      humanInputs: [
        {
          id: 'approval-1',
          runtimeId: 'child-identity',
          taskId: 'child-thread',
          threadTitle: 'Worker',
          title: 'Run tests',
          kind: 'approval',
        },
      ],
    },
  }
  const approvalParent = { ...parent, threadWatches: [approvalWatch] }
  const approvalTarget = notificationTarget({
    runtimeId: 'parent-profile',
    taskId: 'parent-thread',
    kind: 'input',
    inputId: 'child-identity:approval-1',
    inputType: 'approval',
  })
  expect(
    approvalTarget &&
      notificationHref(approvalTarget, {
        profiles,
        overviews: [
          {
            ...overviews[0]!,
            snapshot: { ...overviews[0]!.snapshot, workspace: { tasks: [approvalParent] } },
          },
        ],
      }).params,
  ).toEqual({
    runtimeId: 'child-profile',
    taskId: 'child-thread',
    runtimeIdentity: 'child-identity',
    approvalId: 'approval-1',
  })
  // Without its pairing, the parent still opens the directly paired child thread.
  expect(
    target &&
      notificationHref(target, { profiles: [profiles[0]!], overviews: [overviews[0]!] }).params,
  ).toEqual({
    runtimeId: 'child-profile',
    taskId: 'child-thread',
    runtimeIdentity: 'child-identity',
  })
})
