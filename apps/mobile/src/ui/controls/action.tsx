import { Pressable } from 'react-native'
import { Text } from '../content/text'
import { IconButton } from './icon-button'
import type { IconName } from './icon'
import { colors } from '../theme'
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
  Send: 'send',
  Stop: 'stop',
  Close: 'close',
  Back: 'back',
  'Dismiss keyboard': 'keyboard',
  'Close preview': 'close',
  Artifacts: 'artifact',
  'Latest version': 'history',
  Preview: 'web',
  Source: 'artifact',
  'View source': 'artifact',
  Share: 'share',
  'Share file': 'share',
  Expand: 'expand',
  'Agent & model': 'settings',
  'Device controls': 'settings',
  'Review diff': 'changes',
  'Commit & push': 'changes',
  'Commit all': 'changes',
  'Commit staged changes': 'changes',
  Branches: 'changes',
  'New task': 'newChat',
  'New side chat': 'newChat',
  'Open chat': 'chat',
  'Open task': 'tasks',
  'Open linked task': 'tasks',
  'Go to tasks': 'tasks',
  'Open Settings': 'settings',
  'Open computer settings': 'settings',
  'Manage computers': 'device',
  'All computers': 'device',
  'Write message': 'edit',
  'Send answers': 'send',
  'Send to agent': 'send',
  'Stack a PR': 'stack',
  'Ask agent to update stack': 'stack',
  'Approve review': 'check',
  'Reject review': 'close',
  'Clear filters': 'filters',
  'Reset filters': 'filters',
  'Reset PR filters': 'filters',
  Duplicate: 'copy',
  'Newer activity': 'moveDown',
  'Older activity': 'history',
  'Browse folders': 'folder',
  'Browse runtime folders…': 'folder',
  'Browse repositories': 'projects',
  'Browse skills.sh': 'external',
  'Browse MCP Registry': 'external',
  'View tasks on this device': 'tasks',
  'View pipeline runs for this commit': 'jobs',
  'Show issues': 'issues',
  'Show pull requests': 'pulls',
  'Show pending questions': 'chat',
  'Add task': 'newChat',
  'Add review': 'add',
  'Add comment': 'chat',
  'Add a new computer': 'add',
  'Add MCP server': 'add',
  'Add skill': 'add',
  'Add credential': 'add',
  'New configuration': 'add',
  'New session': 'newChat',
  'New global preset': 'add',
}
function actionIcon(label: string): IconName | undefined {
  if (actionIcons[label]) return actionIcons[label]
  if (/^(Refresh|Retry|Reconnect|Reload)\b/.test(label) || label === 'Try again') return 'refresh'
  if (/^Back\b/.test(label)) return 'back'
  if (/^Cancel\b/.test(label)) return 'close'
  if (/^Save\b/.test(label)) return 'save'
  if (/^(Delete|Remove|Forget|Discard)\b/.test(label)) return 'trash'
  if (/^Stop\b/.test(label)) return 'stop'
  if (/^Changes \(/.test(label)) return 'changes'
  if (/^Version \d+$/.test(label)) return 'history'
  if (/^(Load more|More comments|More jobs|More pipelines)\b/.test(label)) return 'down'
  return undefined
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
  icon?: IconName
}
export function Action(props: ActionProps) {
  const icon = props.icon ?? (props.wide ? undefined : actionIcon(props.label))
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
