import { mobileWorkflow, nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import { decode } from '@dovo/protocol'
import { useRef } from 'react'
import { Alert, View } from 'react-native'
import {
  pullActionSchema,
  pullActionResultSchema,
  type PullAction,
  type PullComment,
  type PullDetail,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Sheet } from '../ui/sheet'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { Action } from '../ui/action'
import { Text } from '../ui/text'
import { colors, styles } from '../ui/theme'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { PullActionOption } from './pull-action-options'
export type PullActionTarget = {
  action: PullAction['action']
  comment?: PullComment
}
export function PullActionSheet({
  repositoryId,
  detail,
  target,
  onClose,
  onDone,
}: {
  repositoryId: string
  detail: PullDetail
  target: PullActionTarget
  onClose: () => void
  onDone: () => void
}) {
  const { connected, callEffect } = useRuntime()
  const [headSha] = useApplicationState(detail.pull.headSha)
  const [title, setTitle] = useApplicationState(detail.pull.title),
    [body, setBody] = useApplicationState(target.action === 'edit' ? detail.pull.body : '')
  const [base, setBase] = useApplicationState(detail.pull.base),
    [reviewers, setReviewers] = useApplicationState(''),
    [teams, setTeams] = useApplicationState('')
  const [event, setEvent] = useApplicationState('comment'),
    [method, setMethod] = useApplicationState<string>(
      detail.capabilities?.mergeMethods[0] ?? 'merge',
    )
  const [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const pending = useRef(false)
  const [operation, setOperation] = useApplicationState('add')
  const labels: Record<PullAction['action'], string> = {
    comment: 'Add comment',
    review: 'Submit review',
    reply: 'Reply',
    resolve: target.comment?.resolved ? 'Reopen discussion' : 'Resolve discussion',
    edit: 'Edit pull request',
    reviewers: 'Request reviewers',
    merge: 'Merge pull request',
    close: 'Close pull request',
    reopen: 'Reopen pull request',
  }
  const submit = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current || !connected || detail.stale || detail.refreshError) return
        pending.current = true
        setBusy(true)
        setError('')
        return yield* mobileWorkflow(function* () {
          const input = decode(pullActionSchema, {
            number: detail.pull.number,
            headSha,
            action: target.action,
            body,
            title,
            base: base === detail.pull.base ? undefined : base,
            operation,
            event,
            method,
            reviewers: reviewers
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
            teams: teams
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
            commentId: target.comment?.id,
            threadId: target.comment?.threadId,
            resolved: !target.comment?.resolved,
          })
          const result = yield* callEffect(
            '/api/scm/pulls/action',
            {
              repositoryId,
              ...input,
            },
            pullActionResultSchema,
          )
          onDone()
          onClose()
          if (result.status === 'queued')
            Alert.alert(
              'Merge queued',
              result.message ??
                'The server is processing this merge. Refresh to see its final state.',
            )
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
  const textAction = ['comment', 'review', 'reply', 'edit'].includes(target.action)
  return (
    <Sheet
      title={labels[target.action]}
      onClose={onClose}
      busy={busy}
      footer={
        <Action
          label={busy ? 'Submitting…' : labels[target.action]}
          disabled={busy || !connected || !!detail.stale || !!detail.refreshError}
          onPress={() => void submit()}
        />
      }
    >
      <Text style={styles.muted}>
        #{detail.pull.number} · {detail.pull.title}
      </Text>
      {target.comment && (
        <Text numberOfLines={4} style={styles.muted}>
          {target.comment.author}: {target.comment.body}
        </Text>
      )}
      {target.action === 'edit' && (
        <>
          <Field label="Title" value={title} onChangeText={setTitle} editable={!busy} />
          <Field label="Target branch" value={base} onChangeText={setBase} editable={!busy} />
        </>
      )}
      {target.action === 'review' && (
        <Choice
          label="Review decision"
          value={event}
          onChange={setEvent}
          disabled={busy}
          items={(detail.capabilities?.reviewDecisions ?? []).map((id) => ({
            id,
            name:
              id === 'approve'
                ? 'Approve'
                : id === 'request-changes'
                  ? 'Request changes'
                  : 'Comment',
          }))}
        />
      )}
      {textAction && (
        <Field
          label={target.action === 'edit' ? 'Description' : 'Message'}
          multiline
          value={body}
          onChangeText={setBody}
          editable={!busy}
          style={{
            minHeight: 150,
            textAlignVertical: 'top',
          }}
          placeholder="Markdown supported"
        />
      )}
      {target.action === 'reviewers' && (
        <>
          <Choice
            label="Reviewer action"
            value={operation}
            onChange={setOperation}
            disabled={busy}
            items={[
              {
                id: 'add',
                name: 'Add reviewers',
              },
              {
                id: 'remove',
                name: 'Remove reviewers',
              },
            ]}
          />
          <Field
            label={
              detail.pull.provider === 'azure-devops'
                ? 'Reviewer identity IDs, separated by commas'
                : detail.pull.provider === 'bitbucket'
                  ? 'Reviewer UUIDs, separated by commas'
                  : 'Reviewer usernames, separated by commas'
            }
            value={reviewers}
            onChangeText={setReviewers}
            editable={!busy}
          />
          {!['bitbucket', 'azure-devops'].includes(detail.pull.provider ?? '') && (
            <Field
              label="Team slugs, separated by commas"
              value={teams}
              onChangeText={setTeams}
              editable={!busy}
            />
          )}
        </>
      )}
      {target.action === 'merge' && (
        <>
          <Text style={styles.text}>
            Merge {detail.pull.head} into {detail.pull.base}?
          </Text>
          <Text style={styles.muted}>
            The server will enforce branch policies. This submits the revision you reviewed:{' '}
            {headSha.slice(0, 8)}.
          </Text>
          <Choice
            label="Merge method"
            value={method}
            onChange={setMethod}
            disabled={busy}
            items={(detail.capabilities?.mergeMethods ?? []).map((id) => ({
              id,
              name:
                id === 'squash'
                  ? 'Squash and merge'
                  : id === 'rebase'
                    ? 'Rebase and merge'
                    : 'Merge commit',
            }))}
          />
        </>
      )}
      {target.action === 'close' && (
        <Text style={styles.text}>Close this pull request without merging its changes?</Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Sheet>
  )
}
export function PullPrimaryAction({
  option,
  onAction,
  disabled,
}: {
  option: PullActionOption | undefined
  onAction: (target: PullActionTarget) => void
  disabled: boolean
}) {
  const insets = useSafeAreaInsets()
  if (!option) return null
  return (
    <View
      style={[
        styles.row,
        {
          justifyContent: 'flex-end',
          flexWrap: 'nowrap',
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: Math.max(8, insets.bottom),
          borderTopWidth: 0.5,
          borderTopColor: colors.border,
        },
      ]}
    >
      <Action
        label={option.label}
        disabled={disabled}
        onPress={() =>
          onAction({
            action: option.action,
          })
        }
      />
    </View>
  )
}
