import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { pipelineSignal, type WatchMessage } from '@dovo/protocol'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { openAppLink } from '../../../ui/content/open-link'
import { useLinkOrigin } from '../../../ui/content/link-origin'

export function WatchMessageCard({ update, taskId }: { update: WatchMessage; taskId: string }) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const origin = useLinkOrigin(taskId)
  const tone = update.status ? pipelineSignal(update.status).tone : 'neutral'
  const open = (url: string) => {
    void openAppLink(url, false, origin).catch((cause: unknown) =>
      Alert.alert(uiText('Could not open link'), String(cause)),
    )
  }
  const failedStep = update.failedStep
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
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}
      >
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
          {update.watching ? uiText('Watching') : uiText('Watch ended')}
        </Text>
      </View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={uiText('Open {value0}', { value0: update.title })}
        onPress={() => open(update.url)}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={[styles.text, { fontWeight: '600', color: colors.accent }]}>
          {update.title} ↗
        </Text>
      </Pressable>
      {(update.commit || update.attempt) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 }}>
          {update.commit && (
            <Text style={[styles.muted, { fontSize: 12 }]}>
              {update.kind === 'pipeline'
                ? uiText('Commit {value0}', { value0: update.commit.slice(0, 8) })
                : update.commit.slice(0, 8)}
            </Text>
          )}
          {update.attempt && (
            <Text style={[styles.muted, { fontSize: 12 }]}>
              {uiText('Attempt {value0}', { value0: update.attempt })}
            </Text>
          )}
        </View>
      )}
      {failedStep && (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={uiText('Open failed step: {value0}', { value0: failedStep.name })}
          onPress={() => open(failedStep.url)}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={[styles.text, { color: colors.accent, textDecorationLine: 'underline' }]}>
            {uiText('Open failed step: {value0}', { value0: failedStep.name })} ↗
          </Text>
        </Pressable>
      )}
      {update.highlights.slice(0, 4).map((item, index) => (
        <Text key={index} style={[styles.text, { fontSize: 12 }]}>
          {item}
        </Text>
      ))}
      {update.highlights.length > 4 && (
        <Text style={styles.muted}>
          <InterfaceText values={{ value0: update.highlights.length - 4 }}>
            {'+{value0} more'}
          </InterfaceText>
        </Text>
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
                ? uiText('Hide details')
                : uiText('View {value0}', {
                    value0: update.kind === 'pipeline' ? 'job results' : 'feedback',
                  })}
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
