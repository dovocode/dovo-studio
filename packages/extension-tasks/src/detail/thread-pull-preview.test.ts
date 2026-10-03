import { expect, it } from 'vite-plus/test'
import { decode, repositorySchema, taskSchema } from '@dovo/protocol'
import { threadPullPreview } from './thread-pull-preview'

const project = decode(repositorySchema, {
  id: 'repo',
  name: 'Project',
  path: '/project',
  branch: 'main',
  gitIdentity: 'github.com/team/project',
})
const task = decode(taskSchema, {
  id: 'task',
  title: 'Task',
  repositoryId: 'repo',
  agentId: '',
  status: 'draft',
  createdAt: '',
  messages: [],
  files: [],
  draft: '',
  example: false,
})
it('opens matching PRs in the configured project, retaining number and ignoring query/hash', () => {
  expect(
    threadPullPreview('https://github.com/team/project/pull/42?tab=checks#discussion', task, [
      project,
    ]),
  ).toEqual({ repositoryId: 'repo', number: 42 })
})
it('does not send unrelated repositories, issues, or ordinary links to the PR endpoint', () => {
  for (const url of [
    'https://github.com/team/other/pull/42',
    'https://github.com/team/project/issues/42',
    'https://example.com',
  ])
    expect(threadPullPreview(url, task, [project])).toBeNull()
})
it('recognizes GitLab merge requests and matches another configured project', () => {
  const gitlab = { ...project, id: 'gitlab', gitIdentity: 'gitlab.com/team/project' }
  expect(
    threadPullPreview('https://gitlab.com/team/project/-/merge_requests/9', task, [
      project,
      gitlab,
    ]),
  ).toEqual({ repositoryId: 'gitlab', number: 9 })
})
it('does not assume linked PRs belong to a legacy project with no remote identity', () => {
  const url = 'https://forge.example/team/project/pulls/7'
  const linkedTask = {
    ...task,
    linkedPullRequests: [
      {
        number: 7,
        title: 'PR',
        url,
        provider: 'forgejo' as const,
        repositoryUrl: 'https://forge.example/team/project',
      },
    ],
  }
  expect(threadPullPreview(url, linkedTask, [{ ...project, gitIdentity: undefined }])).toBeNull()
})
