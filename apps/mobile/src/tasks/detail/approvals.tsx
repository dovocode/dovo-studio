import { runtimeComputerName } from '@dovo/protocol'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { responses } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { styles } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
export function TaskApprovals({ taskId }: { taskId: string }) {
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
            <Text selectable style={styles.muted}>
              {item.detail}
            </Text>
            <View style={styles.row}>
              {/command|bash|shell/i.test(item.title) && (
                <Action
                  label="Always allow in this project"
                  secondary
                  disabled={busy || !connected}
                  onPress={() =>
                    act(() =>
                      callEffect(
                        '/api/approvals',
                        {
                          id: item.id,
                          allow: true,
                          remember: true,
                        },
                        responses.ok,
                      ),
                    )
                  }
                />
              )}
              {[true, false].map((allow) => (
                <Action
                  key={String(allow)}
                  label={allow ? 'Allow once' : 'Deny'}
                  secondary={!allow}
                  disabled={busy || !connected}
                  onPress={() =>
                    act(() =>
                      callEffect(
                        '/api/approvals',
                        {
                          id: item.id,
                          allow,
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
