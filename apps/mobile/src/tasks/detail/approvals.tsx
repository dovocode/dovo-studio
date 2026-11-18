import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { router, useLocalSearchParams } from 'expo-router'
import { useOperationGuard } from '../../runtime/state/use-operation-guard'
import { taskHref } from '../../shell/task-route'
import {
  runtimeComputerName,
  activitySchema,
  type ApprovalDecision,
  approvalActions,
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
import { recordedApprovalDecision, selectTaskApprovals } from './approval-selection'
import { useConversationSelector } from '../conversation/state/provider'
import { NotificationInputView } from '../../notifications/viewport-view'
export function TaskApprovals({ taskId }: { taskId: string }) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { snapshot, connected, profile, connection, readEffect, callEffect } = useRuntime(),
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
  const lookup = !!task && !!approvalId && !approvals.length && connected && visible
  const [receipt, setReceipt] = useState<{ scope: string; decision?: ApprovalDecision }>()
  useEffect(() => {
    if (!lookup || !approvalId) return
    let live = true
    void runClientEffect(
      readEffect(
        '/api/activity',
        { scope: taskId, kind: 'approval', query: approvalId },
        activitySchema,
      ),
    ).then(
      ({ events }) => {
        if (live)
          setReceipt({ scope, decision: recordedApprovalDecision(events, taskId, approvalId) })
      },
      () => {
        if (live) setReceipt({ scope })
      },
    )
    return () => {
      live = false
    }
  }, [lookup, approvalId, taskId, scope, readEffect])
  const decision = receipt?.scope === scope ? receipt.decision : undefined
  const decisionLabel =
    decision === 'deny'
      ? uiText('Recorded decision: Not approved')
      : decision === 'approve'
        ? uiText('Recorded decision: Approved once')
        : decision === 'session'
          ? uiText('Recorded decision: Approved for this session')
          : decision === 'always'
            ? uiText('Recorded decision: Always allowed')
            : undefined
  const remoteInputs = !approvalId && task ? taskRemoteHumanInputs(task) : []
  return (
    <>
      {!!approvalId && !approvals.length && (
        <View style={styles.card}>
          <Text accessibilityRole="alert" style={styles.muted}>
            {decisionLabel ??
              (connected
                ? uiText('This approval has already been resolved or is no longer pending.')
                : uiText('Reconnect to check this approval.'))}
          </Text>
          <Action
            secondary
            label={uiText('Show pending approvals')}
            onPress={() => router.setParams({ approvalId: undefined })}
          />
        </View>
      )}
      {approvals.map((item) => (
        <NotificationInputView
          key={item.id}
          style={styles.card}
          input={
            profile?.id
              ? { runtimeId: profile.id, taskId, inputId: item.id, inputType: 'approval' }
              : undefined
          }
          enabled={visible && connected && !busy && item.taskId === taskId}
        >
          <Text style={styles.muted}>
            <InterfaceText
              values={{
                value0: runtimeComputerName({ profile, snapshot }),
                value1:
                  item.taskId !== taskId &&
                  uiText(' · For child thread: {value0}', {
                    value0:
                      snapshot?.workspace.tasks.find((child) => child.id === item.taskId)?.title ??
                      item.taskId,
                  }),
              }}
            >
              {'Permission request · {value0}{value1}'}
            </InterfaceText>
          </Text>
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
          <ApprovalDetails key={item.id} detail={item.detail} />
          <View style={styles.row}>
            {approvalActions(item).map((action) => (
              <Action
                key={action.decision}
                label={action.label}
                secondary={action.decision !== 'approve'}
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
        </NotificationInputView>
      ))}
      {remoteInputs.map((input) => (
        <View key={JSON.stringify([input.runtimeIdentity, input.id])} style={styles.card}>
          <Text style={styles.muted}>
            <InterfaceText
              values={{
                value0:
                  input.kind === 'approval' ? uiText('Permission request') : uiText('Question'),
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
            onPress={() =>
              router.push(
                taskHref(
                  input.runtimeId,
                  input.taskId,
                  input.kind === 'question' ? input.id : undefined,
                  undefined,
                  input.runtimeIdentity,
                  undefined,
                  input.kind === 'approval' ? input.id : undefined,
                ),
              )
            }
          />
        </View>
      ))}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </>
  )
}
