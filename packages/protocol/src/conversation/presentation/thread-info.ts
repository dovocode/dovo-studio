/** Stable preference keys shared by the desktop and mobile Thread Info panels. */
export const threadInfoSections = [
  { id: 'sharing', label: 'Sharing' },
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

/** Preserve saved order, append new sections, and tolerate removed/duplicate keys. */
export function orderedThreadInfoSections(order: readonly string[] = []) {
  const remaining = new Map<string, (typeof threadInfoSections)[number]>(
    threadInfoSections.map((section) => [section.id, section]),
  )
  const sections: (typeof threadInfoSections)[number][] = []
  for (const id of order) {
    const section = remaining.get(id)
    if (!section) continue
    sections.push(section)
    remaining.delete(id)
  }
  return [...sections, ...remaining.values()]
}

export function moveThreadInfoSection(
  order: readonly string[] | undefined,
  id: ThreadInfoSectionId,
  direction: -1 | 1,
  mobile = false,
) {
  const sections = orderedThreadInfoSections(order)
  const available = sections.filter(
    (section) => !mobile || !('desktopOnly' in section && section.desktopOnly),
  )
  const index = available.findIndex((section) => section.id === id)
  const neighbor = available[index + direction]
  if (index < 0 || !neighbor) return sections.map((section) => section.id)
  const from = sections.findIndex((section) => section.id === id)
  const to = sections.findIndex((section) => section.id === neighbor.id)
  ;[sections[from], sections[to]] = [sections[to]!, sections[from]!]
  return sections.map((section) => section.id)
}
