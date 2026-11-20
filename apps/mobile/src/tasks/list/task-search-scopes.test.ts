import { SCRATCH_PROJECT_ID } from '@dovo/protocol'
import { expect, it } from 'vite-plus/test'
import { taskSearchScopes } from './task-search-scopes'

it('searches every computer with the archive filter when no project is selected', () => {
  expect(taskSearchScopes(['a', 'b'], { archived: true, project: '', projects: [] })).toEqual({
    a: { archived: true },
    b: { archived: true },
  })
})

it('searches only computers that hold the selected project', () => {
  expect(
    taskSearchScopes(['a', 'b'], {
      archived: false,
      project: 'github.com/example/app',
      projects: [
        { runtimeId: 'a', repository: { id: 'app' } },
        { runtimeId: 'a', repository: { id: 'app-copy' } },
      ],
    }),
  ).toEqual({ a: { archived: false, repositoryIds: ['app', 'app-copy'] } })
})

it('keeps General threads and threads without a project ID in No Project', () => {
  expect(
    taskSearchScopes(['a', 'b'], {
      archived: false,
      project: 'scratch',
      projects: [{ runtimeId: 'a', repository: { id: SCRATCH_PROJECT_ID } }],
    }),
  ).toEqual({
    a: { archived: false, repositoryIds: [SCRATCH_PROJECT_ID, ''] },
    b: { archived: false, repositoryIds: [''] },
  })
})
