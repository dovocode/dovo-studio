import { Schema } from 'effect'
import { mutableArray } from '../shared/schema.js'

export const threadSections = [
  { id: 'pinned', name: 'Pinned' },
  { id: 'active', name: 'Open' },
  { id: 'working', name: 'Working' },
  { id: 'waiting', name: 'Waiting' },
  { id: 'snoozed', name: 'Snoozed' },
  { id: 'settled', name: 'Settled' },
] as const
export type ThreadSection = (typeof threadSections)[number]['id']
export const defaultThreadSectionOrder: ThreadSection[] = threadSections.map(
  (section) => section.id,
)
export const threadSectionOrderSchema = mutableArray(
  Schema.Literals(threadSections.map((section) => section.id)),
).pipe(
  Schema.check(
    Schema.makeFilter(
      (order) => order.length === threadSections.length && new Set(order).size === order.length,
      { message: 'Each thread section must appear exactly once' },
    ),
  ),
)
export function moveThreadSection(
  order: readonly ThreadSection[],
  section: ThreadSection,
  direction: -1 | 1,
): ThreadSection[] {
  const next = [...order]
  const index = next.indexOf(section)
  const target = index + direction
  if (index < 0 || target < 0 || target >= next.length) return next
  const other = next[target]
  if (!other) return next
  next[index] = other
  next[target] = section
  return next
}
/** Project groups and the ungrouped list occupy the Open section's position. */
export function orderThreadSections<T>(
  groups: readonly T[],
  key: (group: T) => string,
  order: readonly ThreadSection[] = defaultThreadSectionOrder,
): T[] {
  const rank = (id: string) => order.findIndex((section) => section === id)
  const position = (group: T) => {
    const index = rank(key(group))
    return index < 0 ? rank('active') : index
  }
  return [...groups].sort((a, b) => position(a) - position(b))
}
