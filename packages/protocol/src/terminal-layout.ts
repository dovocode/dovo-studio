export const MAX_TERMINAL_PANES = 4
export type TerminalGroup = { id: string; sessions: string[]; layout: 'columns' | 'rows' }
/** Unassigned sessions (including restored shells) start in their own tab. */
export function terminalGroups(
  groups: readonly TerminalGroup[],
  ids: readonly string[],
): TerminalGroup[] {
  const live = new Set(ids)
  const assigned = new Set<string>()
  const result = groups.flatMap((group) => {
    const sessions = group.sessions.filter((id) => live.has(id) && !assigned.has(id))
    sessions.forEach((id) => assigned.add(id))
    return sessions.length ? [{ ...group, sessions }] : []
  })
  return [
    ...result,
    ...ids
      .filter((id) => !assigned.has(id))
      .map((id) => ({ id, sessions: [id], layout: 'columns' as const })),
  ]
}
export function splitTerminal(
  groups: readonly TerminalGroup[],
  selected: string,
  id: string,
  layout: TerminalGroup['layout'],
): TerminalGroup[] {
  return groups.map((group) =>
    group.sessions.includes(selected) &&
    !group.sessions.includes(id) &&
    group.sessions.length < MAX_TERMINAL_PANES
      ? {
          ...group,
          layout,
          sessions: [
            ...group.sessions.slice(0, group.sessions.indexOf(selected) + 1),
            id,
            ...group.sessions.slice(group.sessions.indexOf(selected) + 1),
          ],
        }
      : group,
  )
}
