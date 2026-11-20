import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { mobileWorkflow, nativeEffect } from '../../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../../../runtime/state/application-state'
import { decode, mutableStruct } from '@dovo/protocol'
import {
  computerIntegrationDraftKey,
  createDetailDrafts,
  useDetailDraft,
} from '../../../runtime/state/detail-drafts'
import { detailDraftStorage } from '../../../runtime/state/detail-draft-storage'
import { DraftStorageNotice } from '../../../ui/content/draft-storage-notice'
import { Schema } from 'effect'
import { useEffect, useRef } from 'react'
import { randomUUID } from 'expo-crypto'
import {
  pullCommentStatusResponse,
  pullLineCommentSchema,
  pullLineCommentResponse,
  type PullDetail,
} from '@dovo/protocol'
import {
  lineCommentRecoveryAllowsPost,
  lineCommentRecoveryMessage,
  lineCommentRecoveryNeedsChoice,
  lineCommentRecoveryReusesId,
  lineCommentRecoveryState,
  type LineCommentCheck,
  type LineCommentRecovery,
} from './line-comment-recovery'
import { useRuntime } from '../../../runtime/connection/provider'
import { Sheet, type SheetHandle } from '../../../ui/layout/sheet'
import { Field } from '../../../ui/controls/field'
import { Choice } from '../../../ui/controls/choice'
import { Action } from '../../../ui/controls/action'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
// Line numbers describe one revision, so drafts are keyed by it and never move to a new head.
// Unsent comments stay on the device after the app restarts. `submissionId` names the last press
// of Post, so a reopened draft can ask the runtime whether that press already posted it.
const lineDrafts = createDetailDrafts({
  isClean: (draft) => !draft.body,
  persist: {
    name: 'pull-line-comment',
    schema: mutableStruct({
      line: Schema.String,
      end: Schema.String,
      side: Schema.String,
      body: Schema.String,
      submissionId: Schema.optional(Schema.String),
    }),
    storage: detailDraftStorage,
  },
})
export function LineComment({
  repositoryId,
  detail: initialDetail,
  latestDetail,
  path,
  onClose,
  onDone,
}: {
  repositoryId: string
  detail: PullDetail
  latestDetail: PullDetail
  path: string
  onClose: () => void
  onDone: () => void
}) {
  const uiText = useInterfaceText()

  const detail = useRef(initialDetail).current
  const { styles } = useTheme()

  const { connected, callEffect, readEffect, profile, snapshot } = useRuntime()
  const { draft, setField, clear, persistence, settle } = useDetailDraft(
    lineDrafts,
    useRef(
      computerIntegrationDraftKey(
        profile,
        snapshot,
        repositoryId,
        undefined,
        'pull-line',
        detail.destination ?? detail.pull.destination,
        detail.pull.repositoryUrl,
        detail.pull.number,
        detail.pull.headSha,
        detail.pull.baseSha,
        path,
      ),
    ).current,
    () => ({
      line: '',
      end: '',
      side: 'additions',
      body: '',
    }),
  )
  const { line, end, side, body, submissionId } = draft
  const receipts = snapshot?.pullCommentReceiptsSupported === true
  const { connectionId, headSha } = detail.pull
  const expectedDestination = detail.destination ?? detail.pull.destination
  const revisionChanged =
    latestDetail.pull.headSha !== headSha || latestDetail.pull.baseSha !== detail.pull.baseSha
  const sourceChanged =
    latestDetail.pull.number !== detail.pull.number ||
    latestDetail.pull.repositoryUrl !== detail.pull.repositoryUrl ||
    latestDetail.pull.connectionId !== connectionId ||
    (latestDetail.destination ?? latestDetail.pull.destination) !== expectedDestination
  const [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  /** Waiting for device storage. The sheet stays open to Cancel and Close while it waits. */
  const [storageWait, setStorageWait] = useApplicationState<'marker' | 'cleanup' | null>(null)
  /** The runtime accepted the comment, but this phone still holds the saved draft. */
  const [accepted, setAccepted] = useApplicationState<{ url: string } | null>(null)
  /** The ID that this editor is sending now. Any other saved ID needs a status check. */
  const [posting, setPosting] = useApplicationState<string | undefined>(undefined)
  const [checked, setChecked] = useApplicationState<LineCommentCheck | undefined>(undefined)
  const [check, setCheck] = useApplicationState(0)
  const recovery = lineCommentRecoveryState({
    submissionId,
    posting,
    receipts,
    connected,
    checked,
    check,
  })
  const pending = useRef(false)
  /** Each press of Post. Cancel, close and a newer press make an older press stop. */
  const attempt = useRef(0)
  /** An ID whose response was lost in this editor. If it was posted, cleanup runs at once. */
  const lost = useRef<string | undefined>(undefined)
  const sheet = useRef<SheetHandle>(null)
  useEffect(
    () => () => {
      attempt.current++
    },
    [],
  )
  const checking = recovery?.status === 'checking'
  useEffect(() => {
    if (!checking || !submissionId) return
    const controller = new AbortController()
    const record = (value: LineCommentRecovery) => {
      if (controller.signal.aborted) return
      setChecked({ id: submissionId, check, value })
      if (value.status === 'posted' && lost.current === submissionId) void cleanupPosted(value.url)
    }
    runClientEffect(
      readEffect('/api/scm/pulls/comment-status', { submissionId }, pullCommentStatusResponse),
      controller.signal,
    ).then(record, () => record({ status: 'check-failed' }))
    return () => controller.abort()
  }, [checking, submissionId, check])
  // An empty editor has nothing to post. This also covers the render before saved drafts load.
  const canSend =
    !!body.trim() &&
    connected &&
    !revisionChanged &&
    !sourceChanged &&
    !latestDetail.stale &&
    !latestDetail.refreshError &&
    !accepted
  const canPost = canSend && lineCommentRecoveryAllowsPost(recovery)
  /** The user checked the pull request and chooses to post despite an unconfirmed outcome. */
  const canPostAnyway = canSend && lineCommentRecoveryNeedsChoice(recovery)
  const setLine = (value: string) => setField('line', value)
  const setEnd = (value: string) => setField('end', value)
  const setSide = (value: string) => setField('side', value)
  const setBody = (value: string) => setField('body', value)
  /** After the runtime accepts the comment, the sheet closes only once the saved copy is gone. */
  const finish = (url: string) =>
    mobileWorkflow(function* () {
      clear()
      setStorageWait('cleanup')
      const cleanup = yield* nativeEffect(() => settle()).pipe(
        Effect.ensuring(nativeEffect(() => setStorageWait(null)).pipe(Effect.orDie)),
      )
      if (cleanup) {
        setAccepted({ url })
        return
      }
      setAccepted(null)
      sheet.current?.dismiss(onDone)
    })
  const guarded = (run: () => Effect.Effect<void, unknown>) =>
    runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current) return
        pending.current = true
        setBusy(true)
        return yield* run().pipe(
          Effect.ensuring(
            nativeEffect(() => {
              pending.current = false
              setBusy(false)
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  const retryCleanup = () =>
    guarded(() =>
      mobileWorkflow(function* () {
        if (!accepted) return
        persistence?.retry()
        yield* finish(accepted.url)
      }),
    )
  const cleanupPosted = (url: string) => guarded(() => finish(url))
  const cancelWait = () => {
    attempt.current++
    pending.current = false
    setBusy(false)
    setStorageWait(null)
  }
  const submit = (anyway = false) => {
    // Read the choice from this render. A retry of an unconfirmed ID keeps that ID.
    const reuse =
      anyway && lineCommentRecoveryReusesId(recovery) && submissionId ? submissionId : undefined
    return runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current || !(anyway ? canPostAnyway : canPost)) return
        pending.current = true
        const current = ++attempt.current
        const active = () => attempt.current === current
        setBusy(true)
        setError('')
        let sent = false
        // Save the ID with the draft and confirm that the device holds it before posting. If the
        // app stops before the saved copy is removed, the reopened draft asks the runtime about
        // this ID instead of offering to post again.
        const id = reuse ?? randomUUID()
        lost.current = undefined
        setPosting(id)
        setField('submissionId', id)
        return yield* mobileWorkflow(function* () {
          setStorageWait('marker')
          const stored = yield* nativeEffect(() => settle()).pipe(
            Effect.ensuring(
              nativeEffect(() => {
                if (active()) setStorageWait(null)
              }).pipe(Effect.orDie),
            ),
          )
          if (!active()) return
          if (stored) {
            setError(
              uiText(
                'This phone could not save a record of this post, so Dovo did not send it. Retry saving drafts, then post again.',
              ),
            )
            return
          }
          const input = decode(pullLineCommentSchema, {
            number: detail.pull.number,
            headSha,
            path,
            side,
            start: Number(line),
            end: Number(end || line),
            body,
          })
          sent = true
          const posted = yield* callEffect(
            '/api/scm/pulls/comment',
            {
              repositoryId,
              ...input,
              expectedDestination,
              connectionId,
              ...(receipts ? { submissionId: id } : {}),
            },
            pullLineCommentResponse,
          )
          yield* finish(posted.url)
        }).pipe(
          Effect.catch((cause) =>
            nativeEffect(() => {
              setError(cause instanceof Error ? cause.message : String(cause))
              if (!sent) return
              // The runtime may have posted it. Check this ID before anything posts again.
              lost.current = id
              setPosting(undefined)
              setCheck((value) => value + 1)
            }),
          ),
          Effect.ensuring(
            nativeEffect(() => {
              if (!active()) return
              pending.current = false
              setBusy(false)
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  }
  const recoveryMessage = lineCommentRecoveryMessage(recovery)
  if (accepted)
    return (
      <Sheet
        ref={sheet}
        title={uiText('Comment on code')}
        onClose={onClose}
        busy={busy && !storageWait}
      >
        <Text selectable style={styles.muted}>
          {path}
        </Text>
        <Text accessibilityRole="alert" style={styles.text}>
          {uiText(
            'Comment posted. This phone could not remove its saved copy. Retry, or it can come back as a draft that Dovo checks before posting.',
          )}
        </Text>
        <Text selectable style={styles.muted}>
          {accepted.url}
        </Text>
        <Action
          label={busy ? uiText('Removing…') : uiText('Retry removing saved copy')}
          disabled={busy}
          onPress={() => void retryCleanup()}
        />
        <Action
          secondary
          label={uiText('Close')}
          disabled={busy}
          onPress={() => sheet.current?.dismiss(onDone)}
        />
      </Sheet>
    )
  return (
    <Sheet
      ref={sheet}
      title={uiText('Comment on code')}
      onClose={onClose}
      busy={busy && !storageWait}
    >
      <Text selectable style={styles.muted}>
        {path}
      </Text>
      {(sourceChanged || revisionChanged) && (
        <Text accessibilityRole="alert" style={styles.muted}>
          {sourceChanged
            ? uiText('The PR source changed. Your draft stays with the original source.')
            : uiText(
                'This draft is saved on the older revision. Switch revision and choose a new line before posting.',
              )}
        </Text>
      )}
      <Choice
        label={uiText('Version')}
        value={side}
        onChange={setSide}
        disabled={busy}
        items={[
          {
            id: 'additions',
            name: uiText('New version'),
          },
          {
            id: 'deletions',
            name: uiText('Old version'),
          },
        ]}
      />
      <Field
        label={uiText('Line in the diff')}
        value={line}
        onChangeText={setLine}
        keyboardType="number-pad"
        editable={!busy}
      />
      {detail.capabilities?.inlineRange && (
        <Field
          label={uiText('End line (optional)')}
          value={end}
          onChangeText={setEnd}
          keyboardType="number-pad"
          editable={!busy}
        />
      )}
      <Field
        label={uiText('Comment')}
        value={body}
        onChangeText={setBody}
        multiline
        editable={!busy}
        style={{
          minHeight: 130,
          textAlignVertical: 'top',
        }}
      />
      <DraftStorageNotice persistence={persistence} />
      {!!recoveryMessage && (
        <Text accessibilityRole="alert" style={styles.muted}>
          {uiText(recoveryMessage)}
        </Text>
      )}
      {recovery?.status === 'posted' && (
        <>
          <Text selectable style={styles.muted}>
            {recovery.url}
          </Text>
          <Action
            label={uiText('Remove saved copy')}
            disabled={busy}
            onPress={() => void cleanupPosted(recovery.url)}
          />
        </>
      )}
      {(recovery?.status === 'pending' || recovery?.status === 'check-failed') && (
        <Action
          secondary
          label={uiText('Check again')}
          disabled={busy || !connected}
          onPress={() => setCheck((current) => current + 1)}
        />
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!receipts && !!snapshot && (
        <Text style={styles.muted}>
          {uiText(
            'This computer cannot confirm a comment after a lost connection. If posting fails, check the pull request before you post again.',
          )}
        </Text>
      )}
      {storageWait === 'marker' && (
        <Text accessibilityRole="alert" style={styles.muted}>
          {uiText('Saving a record of this post on this phone before sending…')}
        </Text>
      )}
      {storageWait === 'cleanup' && (
        <Text accessibilityRole="alert" style={styles.muted}>
          {uiText('Comment posted. Removing the saved copy from this phone…')}
        </Text>
      )}
      {storageWait === 'marker' && (
        <Action secondary label={uiText('Cancel posting')} onPress={cancelWait} />
      )}
      <Action
        label={
          storageWait === 'marker'
            ? uiText('Saving…')
            : busy
              ? uiText('Posting…')
              : uiText('Post comment')
        }
        disabled={busy || !canPost}
        onPress={() => void submit()}
      />
      {canPostAnyway && !busy && (
        <Action secondary label={uiText('Post anyway')} onPress={() => void submit(true)} />
      )}
    </Sheet>
  )
}
