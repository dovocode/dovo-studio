import { Pressable } from 'react-native'
import { Text } from './text'
import { IconButton } from './icon-button'
import type { IconName } from './icon'
import { colors } from './theme'
const actionIcons: Readonly<Partial<Record<string, IconName>>> = {
  'New terminal': 'add',
  'Create PR': 'add',
  'Close shell': 'close',
  'Reconnect terminal': 'refresh',
  Terminal: 'terminal',
  'Refresh details': 'refresh',
  'Retry connection': 'refresh',
  'PR filters': 'filters',
  'Back to PRs': 'back',
  'Attach files': 'add',
  'Task settings': 'settings',
  Send: 'send',
  Stop: 'stop',
  Close: 'close',
  Back: 'back',
  'Dismiss keyboard': 'keyboard',
}
// Irreversible actions read differently from navigation-style links.
const destructive = /^(Forget|Delete|Remove|Revoke|Discard)\b/
type ActionProps = {
  label: string
  onPress: () => void
  disabled?: boolean
  secondary?: boolean
  /** Full-width primary call to action, e.g. the one decision on a form. */
  wide?: boolean
}
export function Action(props: ActionProps) {
  const icon = props.label.startsWith('Changes (') ? 'changes' : actionIcons[props.label]
  if (icon)
    return (
      <IconButton
        label={props.label}
        onPress={props.onPress}
        disabled={props.disabled}
        icon={icon}
        variant={
          props.label === 'Back' || props.label === 'Back to PRs'
            ? 'glass'
            : props.secondary
              ? 'plain'
              : 'filled'
        }
        prominent={!props.secondary}
        size={props.label === 'Send' || props.label === 'Stop' ? 48 : 44}
      />
    )
  return <TextAction {...props} />
}
function TextAction({
  label,
  onPress,
  disabled = false,
  secondary = false,
  wide = false,
}: ActionProps) {
  const danger = destructive.test(label)
  return (
    <Pressable
      testID={label}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 44,
        maxWidth: '100%',
        flexShrink: 0,
        alignSelf: wide ? 'stretch' : 'flex-start',
        minHeight: wide ? 50 : 44,
        // Text-only actions align with the content they belong to; the hit area stays 44pt.
        paddingHorizontal: secondary && !wide ? 0 : 16,
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        backgroundColor: secondary ? 'transparent' : danger ? colors.error : colors.accent,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Text
        style={{
          fontSize: 15,
          fontWeight: '600',
          color: secondary ? (danger ? colors.error : colors.accent) : colors.onAccent,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}
