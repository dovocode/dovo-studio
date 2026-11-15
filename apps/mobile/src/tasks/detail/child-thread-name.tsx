import { useState } from 'react'
import { View } from 'react-native'
import { workspacePatchResultSchema, type Task } from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../../ui/theme'
import { Field } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { useAction } from '../../ui/controls/use-action'
import { Text } from '../../ui/content/text'
type Props = {
  child: Pick<Task, 'id' | 'title'>
  runtimeId: string | null
  runtimeIdentity?: string
}
export function ChildThreadName(props: Props) {
  const { profile } = useRuntime()
  return (
    <ChildThreadNameEditor
      key={JSON.stringify([
        profile?.id,
        profile?.connection,
        props.runtimeId,
        props.runtimeIdentity,
        props.child.id,
      ])}
      {...props}
    />
  )
}
function ChildThreadNameEditor({
  child,
  runtimeId,
  runtimeIdentity,
}: {
  child: Pick<Task, 'id' | 'title'>
  runtimeId: string | null
  runtimeIdentity?: string
}) {
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  const { profile, profiles, overviews, connected, snapshot, call, readRuntime } = useRuntime()
  const action = useAction()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(child.title)
  const [before, setBefore] = useState(child.title)
  const local = runtimeId === profile?.id
  const owner = local ? profile : profiles?.find((item) => item.id === runtimeId)
  const online = local
    ? connected
    : !!overviews?.find((item) => item.profile.id === runtimeId)?.connected
  const identity = local
    ? snapshot?.runtimeId
    : overviews?.find((item) => item.profile.id === runtimeId)?.snapshot?.runtimeId
  const available = online && (!runtimeIdentity || identity === runtimeIdentity)
  return editing ? (
    <View style={{ gap: 8 }}>
      <Field
        label={uiText('Thread title')}
        value={title}
        editable={!action.busy}
        onChangeText={setTitle}
      />
      <Action
        label={uiText('Save title')}
        disabled={!owner || !available || action.busy || !title.trim()}
        onPress={() =>
          action.act(async () => {
            if (!owner) return
            const input = {
              collection: 'tasks',
              id: child.id,
              changes: { title: { before, after: title.trim() } },
            }
            const result = local
              ? await call('/api/workspace', input, workspacePatchResultSchema, 'PATCH')
              : await readRuntime(
                  owner,
                  '/api/workspace',
                  input,
                  workspacePatchResultSchema,
                  'PATCH',
                )
            if (
              result.outcome === 'rejected' ||
              result.outcome === 'reconciled' ||
              result.reconciled
            )
              throw new Error(
                result.reason ?? 'The thread name changed. Reopen Rename thread and try again.',
              )
            setEditing(false)
          })
        }
      />
      <Action
        secondary
        label={uiText('Cancel')}
        disabled={action.busy}
        onPress={() => setEditing(false)}
      />
      {!!action.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {action.error}
        </Text>
      )}
    </View>
  ) : (
    <Action
      secondary
      label={uiText('Rename {value0}', { value0: child.title })}
      disabled={!owner || !available}
      onPress={() => {
        setTitle(child.title)
        setBefore(child.title)
        setEditing(true)
      }}
    />
  )
}
