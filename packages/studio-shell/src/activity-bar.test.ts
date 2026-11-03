import { expect, it } from 'vite-plus/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StudioView } from '@dovo/studio-core'
import { TooltipProvider } from '@dovo/studio-ui'
import { ActivityBar, visibleWorkspaceTarget, workspaceModeVisible } from './activity-bar'

const view = (id: string, title: string, icon: StudioView['icon']): StudioView => ({
  id,
  title,
  icon,
  order: 0,
  load: async () => ({ default: () => null }),
})
const standalone = [
  view('tasks', 'Threads', 'tasks'),
  view('browser', 'Browser', 'browser'),
  view('terminals', 'Terminals', 'terminal'),
]
/** Navigation groups, top to bottom, as the labels of their items. */
function groups(views: StudioView[]) {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(ActivityBar, { views, activeId: 'tasks', onSelect: () => {} }),
    ),
  )
  return html
    .split('class="studio-navigation-group"')
    .slice(1)
    .map((group) => [...group.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((item) => item[1]))
}

it('keeps standalone Threads, Browser and Terminals together with or without unified', () => {
  expect(groups(standalone)).toEqual([['Threads', 'Browser', 'Terminals']])
  // Unified is an extra switch above the standalone workspaces, never a replacement.
  expect(groups([view('workspace', 'Workspace', 'workspace'), ...standalone])).toEqual([
    ['Workspace'],
    ['Threads', 'Browser', 'Terminals'],
  ])
})

it('hides only the normal modes, and only while unified is on', () => {
  const all = [
    view('workspace', 'Workspace', 'workspace'),
    ...standalone,
    view('artifacts', 'Artifacts', 'artifacts'),
  ]
  const shown = (unifiedWorkspaceEnabled: boolean, unifiedWorkspaceHideNormalModes: boolean) =>
    all.filter((item) =>
      workspaceModeVisible(item.id, { unifiedWorkspaceEnabled, unifiedWorkspaceHideNormalModes }),
    )
  expect(groups(shown(true, true))).toEqual([['Workspace'], ['Artifacts']])
  expect(groups(shown(true, false))).toEqual([
    ['Workspace'],
    ['Threads', 'Browser', 'Terminals', 'Artifacts'],
  ])
  // A leftover hide choice is ignored when unified is off, so normal modes stay discoverable.
  expect(shown(false, true).map((item) => item.id)).toEqual(all.map((item) => item.id))
})

it('lands hidden sections on the unified workspace but still opens explicit items', () => {
  const hiding = { unifiedWorkspaceEnabled: true, unifiedWorkspaceHideNormalModes: true }
  for (const viewId of ['tasks', 'browser', 'terminals'])
    expect(visibleWorkspaceTarget({ viewId }, hiding)).toEqual({ viewId: 'workspace' })
  const thread = { viewId: 'tasks', entityId: 'thread-1' }
  expect(visibleWorkspaceTarget(thread, hiding)).toBe(thread)
  const artifacts = { viewId: 'artifacts' }
  expect(visibleWorkspaceTarget(artifacts, hiding)).toBe(artifacts)
  const threads = { viewId: 'tasks' }
  expect(visibleWorkspaceTarget(threads, { ...hiding, unifiedWorkspaceEnabled: false })).toBe(
    threads,
  )
})
