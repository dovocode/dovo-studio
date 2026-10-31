/** Stable preference keys shared by the desktop and mobile Thread Info panels. */
export const threadInfoSections = [
  { id: 'settings', label: 'Environment and access' },
  { id: 'project', label: 'Project and checkout' },
  { id: 'openIn', label: 'Open in editor', desktopOnly: true },
  { id: 'scripts', label: 'Project scripts' },
  { id: 'pulls', label: 'Pull requests' },
  { id: 'git', label: 'Git actions' },
  { id: 'changes', label: 'Changes' },
  { id: 'servers', label: 'Servers' },
  { id: 'projects', label: 'Linked projects' },
  { id: 'activity', label: 'Watching and dependencies' },
  { id: 'lineage', label: 'Related threads and agents' },
  { id: 'usage', label: 'Context usage' },
] as const

export type ThreadInfoSectionId = (typeof threadInfoSections)[number]['id']
