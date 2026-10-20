import { runtimeComputerName, approvalActions } from '@dovo/protocol'
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
  return (
    <>
      {snapshot?.approvals
        .filter((item) => item.taskId === taskId)
        .map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.muted}>
              Permission request · {runtimeComputerName({ profile, snapshot })}
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
      {!!error && <Text style={styles.error}>{error}</Text>}
    </>
  )
}
