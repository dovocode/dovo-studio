import { describe, expect, it } from 'vite-plus/test'
import { workbenchRoute } from './route-paths'

describe('mobile workbench route context', () => {
  it.each([
    ['/', 'tasks', false],
    ['/thread/http%3A%2F%2Fhost%3A51464/task', 'tasks', true],
    ['/projects', 'tasks', true],
    ['/issues/', 'issues', false],
    ['/issues/item/host/project/DOVO-24', 'issues', true],
    ['/issues/jira/host/source/TEAM-42', 'issues', true],
    ['/pulls', 'pulls', false],
    ['/pulls/pr/host/project/7', 'pulls', true],
    ['/pulls/pipeline/host/project/103', 'pulls', true],
    ['/pulls/runs/host/project', 'pulls', true],
    ['/jobs/automation/host/release', 'jobs', true],
    ['/settings', 'settings', false],
    ['/issues-other', 'tasks', true],
  ] as const)('keeps %s in %s with detail=%s', (path, tab, detail) => {
    expect(workbenchRoute(path)).toEqual({ tab, detail })
  })
})
