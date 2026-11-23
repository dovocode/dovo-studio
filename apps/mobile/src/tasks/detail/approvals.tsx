import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { router, useLocalSearchParams } from 'expo-router'
import { useOperationGuard } from '../../runtime/state/use-operation-guard'
import {
  runtimeComputerName,
  activitySchema,
  approvalActions,
  taskFamilyIds,
  taskInputOwner,
  taskInputVisible,
  taskRemoteHumanInputs,
} from '@dovo/protocol'
import { View } from 'react-native'
import { Effect } from 'effect'
import { Text } from '../../ui/content/text'
import { responses } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
import { ApprovalDetails } from './approval-details'
import { useEffect, useMemo, useState } from 'react'
import { clientScopeKey, runClientEffect } from '@dovo/client-runtime'
import {
  recordedApprovalOutcome,
  selectTaskApprovals,
  type RecordedApprovalOutcome,
} from './approval-selection'
import { useConversationSelector } from '../conversation/state/provider'
import { NotificationInputView } from '../../notifications/viewport-view'
import { remoteInputHref } from '../../notifications/target'
export function TaskApprovals({ taskId }: { taskId: string }) {
  const uiText = useInterfaceText()

  const { styles, colors } = useTheme()

  const { snapshot, connected, profile, profiles, overviews, connection, readEffect, callEffect } =
      useRuntime(),
    { busy, error, act } = useAction()
  const { approvalId } = useLocalSearchParams<{ approvalId?: string }>()
  const scope = JSON.stringify([
    profile?.id,
    clientScopeKey(connection),
    snapshot?.runtimeId,
    taskId,
    approvalId,
  ])
  const current = useOperationGuard(scope)
  const visible = useConversationSelector((conversation) => conversation.visible)
  const approvals = useMemo(
    () =>
      selectTaskApprovals(
        snapshot?.approvals.filter((item) =>
          taskInputVisible(snapshot.workspace.tasks, taskId, item),
        ) ?? [],
        approvalId,
      ),
    [snapshot, taskId, approvalId],
  )
  const task = snapshot?.workspace.tasks.find((task) => task.id === taskId)
  const [attempt, setAttempt] = useState(0)
  const [receipt, setReceipt] = useState<{
    scope: string
    attempt: number
    outcome?: RecordedApprovalOutcome
    failed?: true
  }>()
  const result = receipt?.scope === scope && receipt.attempt === attempt ? receipt : undefined
  const outcome = result?.outcome
  // The runtime records an approval under the thread that asked. A child's approval opened from
  // its parent is in the child's scope, so match the exact ID anywhere in the visible family.
  const family = useMemo(
    () => (snapshot ? [...taskFamilyIds(snapshot.workspace.tasks, taskId)] : [taskId]),
    [snapshot, taskId],
  )
  const familyKey = JSON.stringify(family)
  const lookup = !!task && !!approvalId && !approvals.length && connected && visible && !outcome
  useEffect(() => {
    if (!lookup || !approvalId) return
    const controller = new AbortController()
    setReceipt(undefined)
    void runClientEffect(
      readEffect('/api/activity', { kind: 'approval', query: approvalId }, activitySchema),
      controller.signal,
    ).then(
      ({ events }) => {
        if (!controller.signal.aborted)
          setReceipt({
            scope,
            attempt,
            outcome: recordedApprovalOutcome(events, new Set(family), approvalId),
          })
      },
      () => {
        if (!controller.signal.aborted) setReceipt({ scope, attempt, failed: true })
      },
    )
    return () => controller.abort()
  }, [lookup, approvalId, familyKey, scope, attempt, readEffect])
  const decision = outcome && 'decision' in outcome ? outcome.decision : undefined
  const ended = outcome && 'ended' in outcome ? outcome.ended : undefined
  const decisionLabel =
    ended === 'withdrawn'
      ? uiText('This approval request was withdrawn, or its turn ended. No decision was recorded.')
      : ended === 'expired'
        ? uiText('This approval expired. No decision was recorded.')
        : ended === 'access-changed'
          ? uiText('Access changed, so this approval expired. No decision was recorded.')
          : ended === 'cancelled'
            ? uiText('This approval was cancelled. No decision was recorded.')
            : ended === 'other'
              ? uiText('This approval ended without a decision.')
              : decision === 'deny'
                ? uiText('Recorded decision: Not approved')
                : decision === 'approve'
                  ? uiText('Recorded decision: Approved once')
                  : decision === 'session'
                    ? uiText('Recorded decision: Approved for this session')
                    : decision === 'always'
                      ? uiText('Recorded decision: Always allowed')
                      : undefined
  const receiptStatus =
    decisionLabel ??
    (!connected
      ? uiText('Reconnect to check this approval.')
      : !result
        ? uiText('Checking decision…')
        : result.failed
          ? uiText('Could not check this approval.')
          : uiText('This approval has already been resolved or is no longer pending.'))
  const remoteInputs = !approvalId && task ? taskRemoteHumanInputs(task) : []
  const pendingCount = approvals.length + remoteInputs.length
  return (
    <>
      {pendingCount > 1 && (
        <Text style={[styles.muted, { fontSize: 12 }]}>
          {uiText('{value0} requests waiting', { value0: pendingCount })}
        </Text>
      )}
      {!!approvalId && !approvals.length && (
        <View style={styles.card}>
          <Text accessibilityLiveRegion="polite" style={styles.text}>
            {receiptStatus}
          </Text>
          {connected && result?.failed && (
            <Action
              secondary
              label={uiText('Retry')}
              onPress={() => setAttempt((current) => current + 1)}
            />
          )}
          <Action
            secondary
            label={uiText('Show pending approvals')}
            onPress={() => router.setParams({ approvalId: undefined })}
          />
        </View>
      )}
      {approvals.map((item) => {
        const actions = approvalActions(item)
        const immediate = actions.filter(
          ({ decision }) => decision === 'approve' || decision === 'deny',
        )
        const scoped = actions.filter(
          ({ decision }) => decision === 'session' || decision === 'always',
        )
        return (
          <NotificationInputView
            key={item.id}
            style={[styles.card, { gap: 10 }]}
            input={
              profile?.id
                ? {
                    runtimeId: profile.id,
                    taskId: item.taskId,
                    ownerTaskId: snapshot
                      ? taskInputOwner(snapshot.workspace.tasks, item.taskId)
                      : undefined,
                    runtimeIdentity: snapshot?.runtimeId,
                    inputId: item.id,
                    inputType: 'approval',
                  }
                : undefined
            }
            enabled={visible && connected && !busy}
          >
            <Text
              style={[
                styles.text,
                {
                  fontWeight: '600',
                },
              ]}
            >
              {item.title}
            </Text>
            <Text style={styles.muted}>
              <InterfaceText
                values={{
                  value0: runtimeComputerName({ profile, snapshot }),
                  value1:
                    item.taskId !== taskId &&
                    uiText(' · For child thread: {value0}', {
                      value0:
                        snapshot?.workspace.tasks.find((child) => child.id === item.taskId)
                          ?.title ?? item.taskId,
                    }),
                }}
              >
                {'Permission request · {value0}{value1}'}
              </InterfaceText>
            </Text>
            <ApprovalDetails key={item.id} detail={item.detail} />
            <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 8, gap: 4 }}>
              {[immediate, scoped]
                .filter((group) => group.length)
                .map((group) => (
                  <View key={group[0].decision} style={styles.row}>
                    {group.map((action) => (
                      <Action
                        key={action.decision}
                        label={uiText(action.label)}
                        variant={action.decision === 'approve' ? 'default' : 'outline'}
                        disabled={busy || !connected}
                        onPress={() =>
                          act(() =>
                            current() && connected
                              ? callEffect(
                                  '/api/approvals',
                                  {
                                    id: item.id,
                                    allow: action.decision !== 'deny',
                                    decision: action.decision,
                                  },
                                  responses.ok,
                                )
                              : Effect.void,
                          )
                        }
                      />
                    ))}
                  </View>
                ))}
            </View>
          </NotificationInputView>
        )
      })}
      {remoteInputs.map((input) => (
        <View key={JSON.stringify([input.runtimeIdentity, input.id])} style={styles.card}>
          <Text style={styles.muted}>
            <InterfaceText
              values={{
                value0:
                  input.kind === 'approval'
                    ? uiText('Permission request')
                    : uiText('Input request'),
                value1: input.threadTitle,
                value2: input.computerName,
              }}
            >
              {'{value0} · For child thread: {value1} · {value2}'}
            </InterfaceText>
          </Text>
          <Text>{input.title}</Text>
          <Action
            label={uiText('Review request')}
            secondary
            onPress={() => router.push(remoteInputHref(input, profiles, overviews))}
          />
        </View>
      ))}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </>
  )
}
