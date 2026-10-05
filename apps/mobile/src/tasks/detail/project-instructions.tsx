import { useEffect } from 'react'
import { View } from 'react-native'
import { Schema } from 'effect'
import { mutableStruct } from '@dovo/protocol'
import { useApplicationState } from '../../runtime/state/application-state'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import { Field } from '../../ui/controls/field'
import { Sheet } from '../../ui/layout/sheet'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

const readSchema = mutableStruct({ text: Schema.String, version: Schema.String })
const previewSchema = mutableStruct({ diff: Schema.String, changed: Schema.Boolean })
const saveSchema = mutableStruct({ version: Schema.String })
export function ProjectInstructions({
  repositoryId,
  onClose,
}: {
  repositoryId: string
  onClose: () => void
}) {
  const { styles } = useTheme()

  const { call, connected } = useRuntime()
  const [name, setName] = useApplicationState<'AGENTS.md' | 'CLAUDE.md'>('AGENTS.md')
  const [text, setText] = useApplicationState('')
  const [version, setVersion] = useApplicationState('')
  const [diff, setDiff] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  useEffect(() => {
    if (!connected) return
    let active = true
    setBusy(true)
    setError('')
    setDiff('')
    void call('/api/scm/instructions/read', { repositoryId, name }, readSchema)
      .then((result) => {
        if (active) {
          setText(result.text)
          setVersion(result.version)
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause))
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [repositoryId, name, connected])
  const preview = () => {
    setBusy(true)
    setError('')
    void call('/api/scm/instructions/preview', { repositoryId, name, text, version }, previewSchema)
      .then((result) => setDiff(result.changed ? result.diff : 'No changes'))
      .catch((cause: unknown) => setError(String(cause)))
      .finally(() => setBusy(false))
  }
  const save = () => {
    setBusy(true)
    setError('')
    void call('/api/scm/instructions/save', { repositoryId, name, text, version }, saveSchema)
      .then(() => onClose())
      .catch((cause: unknown) => setError(String(cause)))
      .finally(() => setBusy(false))
  }
  return (
    <Sheet title="Project instructions" onClose={onClose} busy={busy}>
      <View style={{ gap: 12 }}>
        <Choice
          label="File"
          value={name}
          items={[
            { id: 'AGENTS.md', name: 'AGENTS.md' },
            { id: 'CLAUDE.md', name: 'CLAUDE.md' },
          ]}
          onChange={(value) => setName(value as typeof name)}
        />
        <Field
          label="Instructions"
          value={text}
          onChangeText={(value) => {
            setText(value)
            setDiff('')
          }}
          multiline
          style={{ minHeight: 240, textAlignVertical: 'top' }}
          editable={!busy && connected}
        />
        <Action secondary label="Review diff" disabled={busy || !version} onPress={preview} />
        {!!diff && (
          <Text selectable style={styles.muted}>
            {diff}
          </Text>
        )}
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Action
          label="Save instructions"
          disabled={busy || !diff || diff === 'No changes'}
          onPress={save}
        />
      </View>
    </Sheet>
  )
}
