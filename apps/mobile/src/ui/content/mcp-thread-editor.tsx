import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { RuntimeRequestError, type LauncherAgent, type Repository } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { createDetailDrafts, useDetailDraft } from '../../runtime/state/detail-drafts'
import { TaskLauncherControls } from '../../tasks/creation/task-launcher-controls'
import { permissionPolicyUIIssue } from '../../agents/permission-policy-controls'
import { Sheet } from '../layout/sheet'
import { Field } from '../controls/field'
import { Action } from '../controls/action'
import { useAction } from '../controls/use-action'
import { Text } from './text'
import { useTheme } from '../theme'

export type McpThreadSelection = { prompt: string; selection: LauncherAgent; repositoryId?: string }
type Draft = McpThreadSelection & { attempt?: McpThreadSelection }
const drafts = createDetailDrafts<Draft>()

/** Preparing and editing a proposal never submits a thread. Only Send calls the owner. */
export function McpThreadEditor({
  draftKey,
  initial,
  repository,
  unavailable,
  allowDestination = false,
  onSend,
  onClose,
}: {
  draftKey: string
  initial: McpThreadSelection
  repository: Repository
  standalone?: boolean
  allowDestination?: boolean
  unavailable?: string
  onSend: (value: McpThreadSelection) => Promise<unknown>
  onClose: () => void
}) {
  const currentKey = useRef<string | undefined>(draftKey)
  currentKey.current = draftKey
  useEffect(
    () => () => {
      currentKey.current = undefined
    },
    [],
  )
  const { snapshot, connected } = useRuntime()
  const { styles } = useTheme()
  const { draft, setField, clear } = useDetailDraft(drafts, draftKey, () => initial)
  const { act, busy, error } = useAction()
  const sending = useRef(false)
  const locked = busy || !!draft.attempt
  const destination =
    snapshot?.workspace.repositories.find((item) => item.id === draft.repositoryId) ?? repository
  const issue = draft.selection.harness
    ? permissionPolicyUIIssue(draft.selection.harness, snapshot?.permissionPolicySupported === true)
    : undefined
  const blocked =
    unavailable ||
    (draft.repositoryId && destination.id !== draft.repositoryId
      ? 'The selected destination is unavailable. Choose another destination.'
      : undefined) ||
    (!connected ? 'Reconnect the source computer before sending.' : undefined)
  return (
    <Sheet
      title="New agent thread"
      busy={busy}
      onClose={onClose}
      footer={
        <Action
          label={draft.attempt ? 'Retry Send' : 'Send'}
          wide
          disabled={busy || !!blocked || !!issue || !draft.prompt.trim() || !snapshot}
          onPress={() => {
            if (sending.current || blocked || issue || !draft.prompt.trim() || !snapshot) return
            sending.current = true
            act(async () => {
              try {
                const attempt = draft.attempt ?? {
                  prompt: draft.prompt.trim(),
                  selection: draft.selection,
                  repositoryId: destination.id,
                }
                if (!draft.attempt) setField('attempt', attempt)
                await onSend(attempt)
                // A delayed acknowledgement must not erase a newer draft for the same action.
                const latest = drafts.read(draftKey)
                if (latest?.attempt === attempt) clear()
                if (currentKey.current === draftKey) onClose()
              } catch (error) {
                if (error instanceof RuntimeRequestError && error.mutationRejected === true)
                  setField('attempt', undefined)
                throw error
              } finally {
                sending.current = false
              }
            })
          }}
        />
      }
    >
      <View style={{ gap: 16 }}>
        <Text style={styles.muted}>
          Review the prompt, harness and model before Send. Preparation starts no work.
        </Text>
        <Text style={styles.muted}>
          New thread destination: {destination.kind === 'scratch' ? 'No project' : destination.name}
        </Text>
        {allowDestination &&
          snapshot?.workspace.repositories.map((item) => (
            <Action
              key={item.id}
              label={`Use ${item.kind === 'scratch' ? 'No project' : item.name}`}
              secondary
              disabled={locked || item.id === destination.id}
              onPress={() => setField('repositoryId', item.id)}
            />
          ))}
        {!!blocked && (
          <Text accessibilityRole="alert" style={styles.error}>
            {blocked}
          </Text>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {!!issue && (
          <Text accessibilityRole="alert" style={styles.error}>
            {issue}
          </Text>
        )}
        <Field
          label="Prompt"
          multiline
          value={draft.prompt}
          editable={!locked}
          onChangeText={(value) => setField('prompt', value)}
          maxLength={120000}
        />
        {snapshot && (
          <TaskLauncherControls
            snapshot={snapshot}
            repository={destination}
            selection={draft.selection}
            onChange={(value) => setField('selection', value)}
            disabled={locked}
          />
        )}
        {draft.attempt && (
          <Text style={styles.muted}>
            The send may have reached the runtime. Retry sends the same prompt and settings so it
            can recover the same thread.
          </Text>
        )}
        <Text style={styles.muted}>Closing this sheet keeps your unsent edits.</Text>
      </View>
    </Sheet>
  )
}
