import { Schema } from 'effect'
import { decodeResult, mutableArray, mutableStruct, type TerminalGroup } from '@dovo/protocol'
const schema = mutableStruct({
  selected: Schema.String,
  groups: mutableArray(
    mutableStruct({
      id: Schema.String,
      sessions: mutableArray(Schema.String),
      layout: Schema.Literals(['columns', 'rows']),
    }),
  ),
})
export function readTerminalLayout(scope: string): { selected: string; groups: TerminalGroup[] } {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`dovo.terminal-layout:${scope}`) ?? 'null',
    )
    const decoded = decodeResult(schema, value)
    if (decoded.success && decoded.data.groups.length <= 20) return decoded.data
  } catch {
    /* Private storage is optional; live shells still work. */
  }
  return { selected: '', groups: [] }
}
export function saveTerminalLayout(scope: string, selected: string, groups: TerminalGroup[]) {
  try {
    localStorage.setItem(`dovo.terminal-layout:${scope}`, JSON.stringify({ selected, groups }))
  } catch {
    /* Keep the current layout in memory when storage is unavailable. */
  }
}
export { MAX_TERMINAL_PANES } from '@dovo/protocol'
export function nextTerminalPane(ids: readonly string[], selected: string, direction: 1 | -1) {
  if (!ids.length) return undefined
  const index = Math.max(0, ids.indexOf(selected))
  return ids[(index + direction + ids.length) % ids.length]
}
