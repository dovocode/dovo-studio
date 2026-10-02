/** Range selection follows the currently visible sidebar order, across open groups. */
export function selectTaskKeys(
  current: ReadonlySet<string>,
  key: string,
  order: readonly string[],
  anchor: string | null,
  range: boolean,
  additive: boolean,
) {
  const next = new Set(additive ? current : [])
  const from = anchor === null ? -1 : order.indexOf(anchor)
  const to = order.indexOf(key)
  if (range && from >= 0 && to >= 0) {
    for (const id of order.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(id)
  } else if (additive && next.has(key)) next.delete(key)
  else next.add(key)
  return next
}
