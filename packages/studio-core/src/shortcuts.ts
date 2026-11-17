import { Schema } from 'effect'
import { mutableStruct } from '@dovo/protocol'

const binding = Schema.optional(Schema.NullOr(Schema.String))
export const shortcutOverridesSchema = mutableStruct({
  palette: binding,
  shortcuts: binding,
  newThread: binding,
  goToThread: binding,
  searchThread: binding,
  searchAll: binding,
  sideQuestion: binding,
  closeSplit: binding,
  changes: binding,
  toolActivity: binding,
  terminal: binding,
})
export type ShortcutOverrides = typeof shortcutOverridesSchema.Type
export const applicationShortcuts = {
  palette: { label: 'Open the command palette', binding: 'Mod+k' },
  shortcuts: { label: 'Show keyboard shortcuts', binding: 'Mod+/' },
  newThread: { label: 'New thread', binding: 'Mod+n' },
  goToThread: { label: 'Go to a thread', binding: 'Mod+p' },
  searchThread: { label: 'Search this thread', binding: 'Mod+f' },
  searchAll: { label: 'Search all conversations', binding: 'Mod+Shift+f' },
  sideQuestion: { label: 'Ask a side question', binding: 'Mod+;' },
  closeSplit: { label: 'Close the side-by-side thread', binding: 'Mod+\\' },
  changes: { label: 'Show or hide changes', binding: 'Mod+Shift+d' },
  toolActivity: { label: 'Cycle tool activity views', binding: 'Control+o' },
  terminal: { label: 'Show or hide the terminal', binding: 'Control+`' },
} as const
export type ApplicationShortcut = keyof typeof applicationShortcuts
type KeyEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>
export const shortcutBinding = (id: ApplicationShortcut, overrides: ShortcutOverrides) =>
  overrides[id] === undefined ? applicationShortcuts[id].binding : overrides[id]
export const shortcutMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const normalized = (binding: string, mac: boolean) =>
  binding.replace('Mod', mac ? 'Meta' : 'Control').toLowerCase()
export function matchesApplicationShortcut(
  event: KeyEvent,
  id: ApplicationShortcut,
  overrides: ShortcutOverrides,
  mac = shortcutMac(),
) {
  const binding = shortcutBinding(id, overrides)
  if (!binding) return false
  const parts = normalized(binding, mac).split('+')
  const key = parts.pop()
  return (
    key === event.key.toLowerCase() &&
    event.metaKey === parts.includes('meta') &&
    event.ctrlKey === parts.includes('control') &&
    event.altKey === parts.includes('alt') &&
    event.shiftKey === parts.includes('shift')
  )
}
export function captureApplicationShortcut(event: KeyEvent, mac = shortcutMac()) {
  if (
    ['Control', 'Meta', 'Alt', 'Shift', 'Dead', 'Unidentified', '+'].includes(event.key) ||
    !(event.ctrlKey || event.metaKey || event.altKey)
  )
    return undefined
  if (
    event.key.length !== 1 &&
    !/^(?:F[1-9]|F1[0-2]|Enter|Arrow(?:Left|Right|Up|Down))$/.test(event.key)
  )
    return undefined
  return [
    event.ctrlKey ? (mac ? 'Control' : 'Mod') : '',
    event.metaKey ? (mac ? 'Mod' : 'Meta') : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.key.toLowerCase(),
  ]
    .filter(Boolean)
    .join('+')
}
export function shortcutConflict(
  id: ApplicationShortcut,
  binding: string,
  overrides: ShortcutOverrides,
  mac = shortcutMac(),
) {
  const canonical = normalized(binding, mac)
  const conflict = (Object.keys(applicationShortcuts) as ApplicationShortcut[]).find(
    (other) =>
      other !== id && normalized(shortcutBinding(other, overrides) ?? '', mac) === canonical,
  )
  if (conflict)
    return `Already used for: ${applicationShortcuts[conflict].label}. Unassign it first.`
  if (
    ['control+tab', 'control+shift+tab', 'meta+q', 'control+w', 'meta+w', 'alt+f4'].includes(
      canonical,
    )
  )
    return 'This shortcut belongs to the browser or operating system.'
  return undefined
}
export function applicationShortcutLabel(id: ApplicationShortcut, overrides: ShortcutOverrides) {
  return (
    shortcutBinding(id, overrides)
      ?.replace('Mod', shortcutMac() ? '⌘' : 'Ctrl')
      .replace('Control', 'Ctrl') ?? 'Unassigned'
  )
}
