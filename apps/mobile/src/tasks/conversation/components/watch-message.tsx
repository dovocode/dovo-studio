import { useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { pipelineSignal, type WatchMessage } from '@dovo/protocol'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { openAppLink } from '../../../ui/content/open-link'
import { useLinkOrigin } from '../../../ui/content/link-origin'

export function WatchMessageCard({ update, taskId }: { update: WatchMessage; taskId: string }) {
  const { colors, styles } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const origin = useLinkOrigin(taskId)
  const tone = update.status ? pipelineSignal(update.status).tone : 'neutral'
  return (
    <View
      accessibilityLabel={update.label}
      style={{
        gap: 8,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text
          style={[
            styles.muted,
            {
              fontSize: 12,
              color:
                tone === 'danger'
                  ? colors.error
                  : tone === 'warning'
                    ? colors.warning
                    : colors.muted,
            },
          ]}
        >
          {update.label}
        </Text>
        <Text style={[styles.muted, { fontSize: 12 }]}>
          {update.watching ? 'Watching' : 'Watch ended'}
        </Text>
      </View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${update.title}`}
        onPress={() => {
          void openAppLink(update.url, false, origin).catch((cause: unknown) =>
            Alert.alert('Could not open link', String(cause)),
          )
        }}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={[styles.text, { fontWeight: '600', color: colors.accent }]}>
          {update.title} ↗
        </Text>
      </Pressable>
      <Text style={[styles.muted, { fontSize: 12 }]}>{update.commit.slice(0, 8)}</Text>
      {update.highlights.slice(0, 4).map((item, index) => (
        <Text key={index} style={[styles.text, { fontSize: 12 }]}>
          {item}
        </Text>
      ))}
      {update.highlights.length > 4 && (
        <Text style={styles.muted}>+{update.highlights.length - 4} more</Text>
      )}
      {!!update.details && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded(!expanded)}
            style={{
              minHeight: 44,
              justifyContent: 'center',
              borderTopWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={[styles.muted, { fontSize: 12 }]}>
              {expanded
                ? 'Hide details'
                : `View ${update.kind === 'pipeline' ? 'job results' : 'feedback'}`}
            </Text>
          </Pressable>
          {expanded && (
            <Text selectable style={[styles.text, { fontSize: 13 }]}>
              {update.details}
            </Text>
          )}
        </>
      )}
    </View>
  )
}
