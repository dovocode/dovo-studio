import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { router } from 'expo-router'
import { taskHref } from '../../shell/task-route'
import {
  runtimeComputerName,
  approvalActions,
  taskInputVisible,
  taskRemoteHumanInputs,
} from '@dovo/protocol'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { responses } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
import { ApprovalDetails } from './approval-details'
import { useMemo } from 'react'
import { useConversationSelector } from '../conversation/state/provider'
import { NotificationInputView } from '../../notifications/viewport-view'
export function TaskApprovals({ taskId }: { taskId: string }) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { snapshot, connected, profile, callEffect } = useRuntime(),
    { busy, error, act } = useAction()
  const visible = useConversationSelector((conversation) => conversation.visible)
  const approvals = useMemo(
    () =>
      snapshot?.approvals.filter((item) =>
        taskInputVisible(snapshot.workspace.tasks, taskId, item),
      ) ?? [],
    [snapshot, taskId],
  )
  const task = snapshot?.workspace.tasks.find((task) => task.id === taskId)
  const remoteInputs = task ? taskRemoteHumanInputs(task) : []
  return (
    <>
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
                    callEffect(
                      '/api/approvals',
                      {
                        id: item.id,
                        allow: action.decision !== 'deny',
                        decision: action.decision,
                      },
                      responses.ok,
                    ),
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
                  undefined,
                  undefined,
                  input.runtimeIdentity,
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
