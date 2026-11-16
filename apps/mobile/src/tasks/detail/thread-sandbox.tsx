import { Pressable, View } from 'react-native'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  containerSandboxNetworkWarning as sandboxNetworkWarning,
  containerSandboxEnabled,
  resolveScopedSettings,
  taskContainerSandbox,
  type ContainerSandbox,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { Icon } from '../../ui/controls/icon'
import { useTheme } from '../../ui/theme'

function useThreadSandbox(task: Task) {
  const { snapshot } = useRuntime()
  const repository = snapshot?.workspace.repositories.find((item) => item.id === task.repositoryId)
  const sandbox = snapshot?.containerSandboxSupported
    ? taskContainerSandbox(task, snapshot.defaults, repository)
    : undefined
  return {
    supported: snapshot?.containerSandboxSupported === true,
    sandbox,
    projectDefault: resolveScopedSettings(snapshot?.defaults, repository).taskDefaults
      ?.containerSandbox,
    status: snapshot?.containerSandbox,
    thread: snapshot?.containerSandbox?.threads.find((item) => item.taskId === task.id),
  }
}

/** Shows that a started thread runs in a container sandbox, with its current state. */
export function ThreadSandboxBadge({ task }: { task: Task }) {
  const uiText = useInterfaceText()
  const { colors, styles } = useTheme()
  const { sandbox, thread } = useThreadSandbox(task)
  if (!containerSandboxEnabled(sandbox)) return null
  const state = thread && thread.state !== 'running' ? ` · ${uiText(thread.state)}` : ''
  return (
    <View
      accessibilityLabel={uiText('Container sandbox')}
      accessibilityValue={{ text: thread?.detail ?? thread?.state ?? '' }}
      style={{ gap: 4 }}
    >
      <View style={[styles.row, { gap: 8 }]}>
        <Icon
          name="stack"
          size={14}
          color={thread?.state === 'failed' ? colors.error : colors.muted}
        />
        <Text style={styles.muted}>
          {uiText('Mise sandbox')}
          {sandbox?.network === 'none' ? ` · ${uiText('no network')}` : ''}
          {state}
        </Text>
      </View>
      {!!thread?.detail && thread.state !== 'running' && (
        <Text style={[styles.muted, { fontSize: 12 }]} numberOfLines={6}>
          {thread.detail}
        </Text>
      )}
    </View>
  )
}

/** Host or sandbox, before the first message. Pressing switches between them. */
export function ThreadSandboxChoice({
  task,
  disabled,
  onChange,
}: {
  task: Task
  disabled: boolean
  onChange: (value: ContainerSandbox) => void
}) {
  const uiText = useInterfaceText()
  const { colors, styles } = useTheme()
  const { supported, sandbox, projectDefault, status } = useThreadSandbox(task)
  if (!supported) return null
  const enabled = containerSandboxEnabled(sandbox)
  const label = enabled ? uiText('Mise sandbox') : uiText('Host')
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        testID="Container sandbox"
        accessibilityRole="switch"
        accessibilityLabel={uiText('Container sandbox')}
        accessibilityState={{ checked: enabled, disabled }}
        disabled={disabled}
        onPress={() =>
          onChange({
            ...(task.containerSandbox ?? projectDefault ?? { mode: 'off' }),
            mode: enabled ? 'off' : 'mise',
          })
        }
        style={({ pressed }) => ({
          minHeight: 44,
          borderRadius: 12,
          backgroundColor: colors.surface,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          opacity: pressed || disabled ? 0.5 : 1,
        })}
      >
        <Icon name={enabled ? 'stack' : 'device'} size={14} color={colors.muted} />
        <Text style={[styles.muted, { flex: 1 }]}>{label}</Text>
      </Pressable>
      {enabled && sandbox?.network === 'none' && (
        <Text style={[styles.muted, { fontSize: 12 }]}>{uiText(sandboxNetworkWarning)}</Text>
      )}
      {enabled && status && !status.available && !!status.message && (
        <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 12 }}>
          {status.message}
        </Text>
      )}
    </View>
  )
}
