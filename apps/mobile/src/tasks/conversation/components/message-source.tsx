import { messageSourceLabel, type MessageSource as Source } from '@dovo/protocol'
import { Alert, Pressable } from 'react-native'
import { router } from 'expo-router'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { useRuntime } from '../../../runtime/connection/provider'
import { taskHref } from '../../../shell/task-route'
import { automationHref } from '../../../shell/source-route'
import { openAppLink } from '../../../ui/content/open-link'
import { useLinkOrigin } from '../../../ui/content/link-origin'
import { useSheetNavigation } from '../../../ui/layout/sheet'

export function MessageSource({ source, taskId }: { source: Source; taskId: string }) {
  const { colors, styles } = useTheme()
  const { activeId, profiles, overviews } = useRuntime()
  const origin = useLinkOrigin(taskId)
  const navigateAfterSheet = useSheetNavigation()
  const label = messageSourceLabel(source)
  const linked = source.kind !== 'user' && source.kind !== 'system'
  const open = () => {
    if (source.kind === 'pipeline' || source.kind === 'pull-request') {
      navigateAfterSheet(() => {
        void openAppLink(source.url, false, origin).catch((error: unknown) =>
          Alert.alert('Could not open source', String(error)),
        )
      })
    } else if (source.kind === 'thread') {
      const saved = source.runtimeIdentity
        ? (profiles.find((profile) => profile.connection.runtimeId === source.runtimeIdentity)
            ?.id ??
          overviews.find((overview) => overview.snapshot?.runtimeId === source.runtimeIdentity)
            ?.profile.id)
        : undefined
      const owner = saved ?? (source.runtimeId === 'local' ? activeId : source.runtimeId)
      if (!owner)
        return Alert.alert(
          'Computer unavailable',
          'Connect the owning computer to open this thread.',
        )
      navigateAfterSheet(() =>
        router.push(taskHref(owner, source.threadId, undefined, undefined, source.runtimeIdentity)),
      )
    } else if (source.kind === 'automation' && activeId) {
      navigateAfterSheet(() => router.push(automationHref(activeId, source.automationId)))
    }
  }
  if (!linked) return <Text style={[styles.muted, { fontSize: 12 }]}>{label}</Text>
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open source: ${label}`}
      onPress={open}
      style={{ minHeight: 44, justifyContent: 'center', minWidth: 0 }}
    >
      <Text numberOfLines={1} style={{ color: colors.accent, fontSize: 12 }}>
        {label}
      </Text>
    </Pressable>
  )
}
