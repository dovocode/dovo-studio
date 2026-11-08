import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { checkpointFiles, sideThreadChangesResultSchema } from '@dovo/protocol'
import type { Schema } from 'effect'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import { Text } from '../../ui/content/text'
import { Sheet } from '../../ui/layout/sheet'
import { useTheme } from '../../ui/theme'
import { SavedFilePreview } from '../files/saved-file-preview'

type SideThreadChanges = Schema.Schema.Type<typeof sideThreadChangesResultSchema>

/** Compare against the child's creation snapshot so inherited parent edits are excluded. */
export function SideThreadChanges({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { read, connected, profile, snapshot } = useRuntime()
  const { styles } = useTheme()
  const scope = JSON.stringify([
    profile?.id,
    profile?.connection.address,
    snapshot?.runtimeId,
    taskId,
  ])
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState('')
  const [state, setState] = useState<{
    scope: string
    value?: SideThreadChanges
    busy: boolean
    error: string
  }>({ scope, busy: false, error: '' })
  const current = state.scope === scope ? state : undefined
  useEffect(() => {
    if (!connected) return
    let active = true
    setState((previous) => ({
      scope,
      value: previous.scope === scope ? previous.value : undefined,
      busy: true,
      error: '',
    }))
    void read('/api/tasks/side-thread/changes', { id: taskId }, sideThreadChangesResultSchema).then(
      (value) => {
        if (active) setState({ scope, value, busy: false, error: '' })
      },
      (cause: unknown) => {
        if (active)
          setState((previous) => ({
            ...previous,
            busy: false,
            error: cause instanceof Error ? cause.message : String(cause),
          }))
      },
    )
    return () => {
      active = false
    }
  }, [read, connected, scope, taskId, attempt])
  const files = current?.value ? checkpointFiles(current.value) : []
  const file = files.find((item) => item.path === selected) ?? files[0]
  return (
    <Sheet title="Side-chat changes" onClose={onClose} scrollable={false}>
      <View style={{ flex: 1, gap: 12 }}>
        <Text style={styles.muted}>
          Changes since this side chat started. Parent edits from its starting snapshot are
          excluded.
        </Text>
        <Action
          secondary
          label={current?.busy ? 'Refreshing changes…' : 'Refresh changes'}
          disabled={!connected || !!current?.busy}
          onPress={() => setAttempt((value) => value + 1)}
        />
        {!connected && <Text style={styles.muted}>Connect to refresh these changes.</Text>}
        {!!current?.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {current.error}
          </Text>
        )}
        {!current?.value ? (
          <Text style={styles.muted}>
            {current?.busy ? 'Loading side-chat changes…' : 'No snapshot loaded.'}
          </Text>
        ) : !files.length ? (
          <Text style={styles.muted}>No changes since this side chat started.</Text>
        ) : file ? (
          <>
            <Choice
              label="Changed file"
              value={file.path}
              items={files.map((item) => ({ id: item.path, name: item.path }))}
              onChange={setSelected}
            />
            <View style={{ flex: 1, minHeight: 240 }}>
              <SavedFilePreview
                key={JSON.stringify([scope, current.value.after, file.path])}
                taskId={taskId}
                file={file}
                sideThreadSnapshot={{ before: current.value.before, after: current.value.after }}
              />
            </View>
          </>
        ) : null}
      </View>
    </Sheet>
  )
}
