import { Platform } from 'react-native'
import { Text } from '../content/text'
import { SymbolView } from 'expo-symbols'
import { colors } from '../theme'
/** [SF Symbol, text fallback, Material Symbol]. Android draws the Material icon, like its tabs. */
export const symbols = {
  agents: ['person.2', '♙', 'group'],
  expand: ['arrow.up.left.and.arrow.down.right', '⤢', 'open_in_full'],
  collapse: ['arrow.down.right.and.arrow.up.left', '⤡', 'close_fullscreen'],
  add: ['plus', '+', 'add'],
  web: ['globe', '◎', 'language'],
  chat: ['bubble.left', '▤', 'chat_bubble'],
  device: ['desktopcomputer', '▣', 'computer'],
  terminal: ['terminal', '⌘', 'terminal'],
  changes: ['arrow.triangle.branch', '⑂', 'difference'],
  refresh: ['arrow.clockwise', '↻', 'refresh'],
  star: ['star', '★', 'star'],
  moveUp: ['arrow.up', '↑', 'arrow_upward'],
  moveDown: ['arrow.down', '↓', 'arrow_downward'],
  trash: ['trash', '×', 'delete'],
  filters: ['line.3.horizontal.decrease', '☷', 'filter_list'],
  search: ['magnifyingglass', '⌕', 'search'],
  tasks: ['checklist', '☑', 'checklist'],
  pulls: ['arrow.triangle.pull', '⑂', 'merge'],
  jobs: ['square.stack.3d.up', '▱', 'layers'],
  settings: ['gearshape', '⚙', 'settings'],
  send: ['arrow.up', '↑', 'arrow_upward'],
  stop: ['stop.fill', '■', 'stop'],
  close: ['xmark', '×', 'close'],
  back: ['chevron.left', '‹', 'arrow_back'],
  down: ['chevron.down', '⌄', 'keyboard_arrow_down'],
  next: ['chevron.right', '›', 'chevron_right'],
  check: ['checkmark', '✓', 'check'],
  copy: ['doc.on.doc', '⧉', 'content_copy'],
  error: ['exclamationmark.circle', '!', 'error'],
  attach: ['paperclip', '＋', 'attach_file'],
  keyboard: ['keyboard.chevron.compact.down', '⌄', 'keyboard_hide'],
  folder: ['folder', '▱', 'folder'],
  home: ['house', '⌂', 'home'],
  microphone: ['mic', '●', 'mic'],
  waveform: ['waveform', '≋', 'graphic_eq'],
  car: ['car', '⛟', 'directions_car'],
  more: ['ellipsis', '⋯', 'more_vert'],
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
  ) : Platform.OS === 'android' ? (
    <SymbolView
      name={{ android: symbols[name][2] }}
      tintColor={color}
      size={size}
      style={{ width: size, height: size }}
      fallback={
        <Text style={{ color, fontSize: size, lineHeight: size + 3 }}>{symbols[name][1]}</Text>
      }
    />
  ) : (
    <Text style={{ color, fontSize: size, lineHeight: size + 3 }}>{symbols[name][1]}</Text>
  )
}
