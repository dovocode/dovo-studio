import { Pressable } from 'react-native'
import { Text } from '../content/text'
import { IconButton } from './icon-button'
import type { IconName } from './icon'
import { useTheme } from '../theme'
// Irreversible actions read differently from navigation-style links.
const destructive = /^(Forget|Delete|Remove|Revoke|Discard)\b/
type ActionProps = {
  label: string
  onPress: () => void
  disabled?: boolean
  secondary?: boolean
  /** Text actions share the web button hierarchy; icon actions keep native styling. */
  variant?: 'default' | 'outline' | 'ghost'
  /** Full-width primary call to action, e.g. the one decision on a form. */
  wide?: boolean
  icon?: IconName
}
export function Action(props: ActionProps) {
  const { colors } = useTheme()
  const secondary = props.variant ? props.variant !== 'default' : props.secondary

  const icon = props.icon
  if (icon)
    return (
      <IconButton
        label={props.label}
        onPress={props.onPress}
        disabled={props.disabled}
        icon={icon}
        color={destructive.test(props.label) ? colors.error : undefined}
        variant={
          props.label === 'Back' || props.label === 'Back to PRs'
            ? 'glass'
            : secondary
              ? 'plain'
              : 'filled'
        }
        prominent={!secondary}
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
  variant = secondary ? 'ghost' : 'default',
  wide = false,
}: ActionProps) {
  const { colors } = useTheme()

  const danger = destructive.test(label)
  const filled = variant === 'default'
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
        flexShrink: 1,
        alignSelf: wide ? 'stretch' : 'flex-start',
        minHeight: wide ? 50 : 44,
        // Text-only actions align with the content they belong to; the hit area stays 44pt.
        paddingHorizontal: variant === 'ghost' && !wide ? 0 : 16,
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: variant === 'outline' ? 1 : 0,
        borderColor: colors.border,
        backgroundColor: filled
          ? danger
            ? colors.error
            : colors.action
          : variant === 'outline'
            ? pressed
              ? colors.selection
              : colors.background
            : 'transparent',
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Text
        style={{
          fontSize: 15,
          fontWeight: '600',
          color: !filled
            ? danger
              ? colors.error
              : variant === 'outline'
                ? colors.text
                : colors.accent
            : danger
              ? colors.onError
              : colors.onAccent,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}
