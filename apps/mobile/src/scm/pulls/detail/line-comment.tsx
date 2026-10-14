import { mobileWorkflow, nativeEffect } from '../../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../../../runtime/state/application-state'
import { decode } from '@dovo/protocol'
import {
  createDetailDrafts,
  integrationDraftKey,
  useDetailDraft,
} from '../../../runtime/state/detail-drafts'
import { useRef } from 'react'
import { pullLineCommentSchema, pullLineCommentResponse, type PullDetail } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { Sheet, type SheetHandle } from '../../../ui/layout/sheet'
import { Field } from '../../../ui/controls/field'
import { Choice } from '../../../ui/controls/choice'
import { Action } from '../../../ui/controls/action'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
const lineDrafts = createDetailDrafts<{
  headSha: string
  line: string
  end: string
  side: string
  body: string
}>()
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
  const { styles } = useTheme()

  const { connected, callEffect, connection, snapshot } = useRuntime()
  const { draft, setField, clear } = useDetailDraft(
    lineDrafts,
    integrationDraftKey(
      connection,
      snapshot,
      repositoryId,
      undefined,
      'pull-line',
      detail.pull.repositoryUrl,
      detail.pull.number,
      path,
    ),
    () => ({ headSha: detail.pull.headSha, line: '', end: '', side: 'additions', body: '' }),
  )
  const { headSha, line, end, side, body } = draft
  const setLine = (value: string) => setField('line', value)
  const setEnd = (value: string) => setField('end', value)
  const setSide = (value: string) => setField('side', value)
  const setBody = (value: string) => setField('body', value)
  const [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const pending = useRef(false)
  const sheet = useRef<SheetHandle>(null)
  const submit = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current || !connected || detail.stale || detail.refreshError) return
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
          clear()
          sheet.current?.dismiss(onDone)
        }).pipe(
          Effect.catch((cause) =>
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
    <Sheet ref={sheet} title="Comment on code" onClose={onClose} busy={busy}>
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
        disabled={busy || !connected || !!detail.stale || !!detail.refreshError}
        onPress={() => void submit()}
      />
    </Sheet>
  )
}
