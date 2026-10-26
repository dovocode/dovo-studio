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
export function TaskApprovals({ taskId }: { taskId: string }) {
  const { styles } = useTheme()

  const { snapshot, connected, profile, callEffect } = useRuntime(),
    { busy, error, act } = useAction()
  const task = snapshot?.workspace.tasks.find((task) => task.id === taskId)
  const remoteInputs = task ? taskRemoteHumanInputs(task) : []
  return (
    <>
      {snapshot?.approvals
        .filter((item) => taskInputVisible(snapshot.workspace.tasks, taskId, item))
        .map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.muted}>
              Permission request · {runtimeComputerName({ profile, snapshot })}
              {item.taskId !== taskId &&
                ` · For child thread: ${snapshot.workspace.tasks.find((child) => child.id === item.taskId)?.title ?? item.taskId}`}
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
          </View>
        ))}
      {remoteInputs.map((input) => (
        <View key={JSON.stringify([input.runtimeIdentity, input.id])} style={styles.card}>
          <Text style={styles.muted}>
            {input.kind === 'approval' ? 'Permission request' : 'Question'} · For child thread:{' '}
            {input.threadTitle} · {input.computerName}
          </Text>
          <Text>{input.title}</Text>
          <Action
            label="Review request"
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
