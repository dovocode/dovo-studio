export const collectionPaths = {
  tasks: '/',
  issues: '/issues',
  pulls: '/pulls',
  jobs: '/jobs',
  settings: '/settings',
} as const

export type WorkbenchTab = keyof typeof collectionPaths

/** Match entire path segments so a detail keeps its owning native tab's focus and chrome. */
export function workbenchRoute(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/'
  const tab: WorkbenchTab =
    (['issues', 'pulls', 'jobs', 'settings'] as const).find(
      (tab) => path === collectionPaths[tab] || path.startsWith(`${collectionPaths[tab]}/`),
    ) ?? 'tasks'
  return { tab, detail: path !== collectionPaths[tab] }
}
