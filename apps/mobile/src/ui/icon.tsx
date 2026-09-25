import { Platform } from 'react-native'
import { Text } from './text'
import { SymbolView } from 'expo-symbols'
import { colors } from './theme'
export const symbols = {
  agents: ['person.2', '♙'],
  expand: ['arrow.up.left.and.arrow.down.right', '⤢'],
  collapse: ['arrow.down.right.and.arrow.up.left', '⤡'],
  add: ['plus', '+'],
  web: ['globe', '◎'],
  chat: ['bubble.left', '▤'],
  device: ['desktopcomputer', '▣'],
  terminal: ['terminal', '⌘'],
  changes: ['arrow.triangle.branch', '⑂'],
  refresh: ['arrow.clockwise', '↻'],
  moveUp: ['arrow.up', '↑'],
  moveDown: ['arrow.down', '↓'],
  trash: ['trash', '×'],
  filters: ['line.3.horizontal.decrease', '☷'],
  search: ['magnifyingglass', '⌕'],
  tasks: ['checklist', '☑'],
  pulls: ['arrow.triangle.pull', '⑂'],
  jobs: ['square.stack.3d.up', '▱'],
  settings: ['gearshape', '⚙'],
  send: ['arrow.up', '↑'],
  stop: ['stop.fill', '■'],
  close: ['xmark', '×'],
  back: ['chevron.left', '‹'],
  down: ['chevron.down', '⌄'],
  next: ['chevron.right', '›'],
  check: ['checkmark', '✓'],
  copy: ['doc.on.doc', '⧉'],
  error: ['exclamationmark.circle', '!'],
  attach: ['paperclip', '＋'],
  keyboard: ['keyboard.chevron.compact.down', '⌄'],
  folder: ['folder', '▱'],
  home: ['house', '⌂'],
  microphone: ['mic', '●'],
  waveform: ['waveform', '≋'],
} as const
export type IconName = keyof typeof symbols
export function Icon({
  name,
  size = 20,
  color = colors.text,
}: {
  name: IconName
  size?: number
  color?: string
}) {
  return Platform.OS === 'ios' ? (
    <SymbolView
      name={symbols[name][0]}
      tintColor={color}
      size={size}
      weight="medium"
      style={{ width: size, height: size }}
    />
  ) : (
    <Text style={{ color, fontSize: size, lineHeight: size + 3 }}>{symbols[name][1]}</Text>
  )
}
