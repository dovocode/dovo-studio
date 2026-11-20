import { expect, it } from 'vite-plus/test'
import { taskHref, taskRouteHref } from './task-route'

it('rebuilds every task route parameter, so a return keeps the request and parent', () => {
  const routes = [
    taskHref('computer', 'thread'),
    taskHref('computer', 'thread', 'question'),
    taskHref('computer', 'thread', undefined, undefined, undefined, undefined, 'approval'),
    // A child thread opened from its parent on another computer, on a native agent's tab.
    taskHref(
      'child-computer',
      'child',
      'question',
      {
        runtimeId: 'parent-computer',
        runtimeIdentity: 'parent-id',
        taskId: 'parent',
        title: 'Plan',
      },
      'child-id',
      'native-agent',
      'approval',
    ),
  ]
  for (const route of routes) {
    const { runtimeId, taskId } = route.params
    expect(taskRouteHref({ ...route.params, runtimeId, taskId }, 'Thread')).toEqual(route)
  }
  // An older link without a parent title still returns to its parent.
  expect(
    taskRouteHref(
      {
        runtimeId: 'computer',
        taskId: 'child',
        parentRuntimeId: 'computer',
        parentTaskId: 'parent',
      },
      'Thread',
    ).params,
  ).toMatchObject({ parentTaskId: 'parent', parentTitle: 'Thread' })
})
