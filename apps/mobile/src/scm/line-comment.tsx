import { mobileWorkflow, nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import { decode } from '@dovo/protocol'
import { useRef } from 'react'
import { pullLineCommentSchema, pullLineCommentResponse, type PullDetail } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Sheet } from '../ui/sheet'
import { Field } from '../ui/field'
import { Choice } from '../ui/choice'
import { Action } from '../ui/action'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'
export function LineComment({
  repositoryId,
  detail,
  path,
  onClose,
  onDone,
}: {
  repositoryId: string
  detail: PullDetail
  path: string
  onClose: () => void
  onDone: () => void
}) {
  const { connected, callEffect } = useRuntime()
  const [headSha] = useApplicationState(detail.pull.headSha),
    [line, setLine] = useApplicationState(''),
    [end, setEnd] = useApplicationState(''),
    [side, setSide] = useApplicationState('additions'),
    [body, setBody] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const pending = useRef(false)
  const submit = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current) return
        pending.current = true
        setBusy(true)
        setError('')
        return yield* mobileWorkflow(function* () {
          const input = decode(pullLineCommentSchema, {
            number: detail.pull.number,
            headSha,
            path,
            side,
            start: Number(line),
            end: Number(end || line),
            body,
          })
          yield* callEffect(
            '/api/scm/pulls/comment',
            {
              repositoryId,
              ...input,
            },
            pullLineCommentResponse,
          )
          onDone()
          onClose()
        }).pipe(
          Effect.catchAll((cause) =>
            nativeEffect(() => {
              setError(cause instanceof Error ? cause.message : String(cause))
            }),
          ),
          Effect.ensuring(
            nativeEffect(() => {
              pending.current = false
              setBusy(false)
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  }
  return (
    <Sheet title="Comment on code" onClose={onClose} busy={busy}>
      <Text selectable style={styles.muted}>
        {path}
      </Text>
      <Choice
        label="Version"
        value={side}
        onChange={setSide}
        disabled={busy}
        items={[
          {
            id: 'additions',
            name: 'New version',
          },
          {
            id: 'deletions',
            name: 'Old version',
          },
        ]}
      />
      <Field
        label="Line in the diff"
        value={line}
        onChangeText={setLine}
        keyboardType="number-pad"
        editable={!busy}
      />
      {detail.capabilities?.inlineRange && (
        <Field
          label="End line (optional)"
          value={end}
          onChangeText={setEnd}
          keyboardType="number-pad"
          editable={!busy}
        />
      )}
      <Field
        label="Comment"
        value={body}
        onChangeText={setBody}
        multiline
        editable={!busy}
        style={{
          minHeight: 130,
          textAlignVertical: 'top',
        }}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        label={busy ? 'Posting…' : 'Post comment'}
        disabled={busy || !connected}
        onPress={() => void submit()}
      />
    </Sheet>
  )
}
