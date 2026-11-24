import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { parseStudioLink, threadReferenceLink } from '@dovo/protocol'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { useRuntime } from '../../../runtime/connection/provider'
import { EmptyState } from '../../../ui/content/empty-state'
import { studioThreadHref } from '../../../ui/content/app-link-target'
import { Action } from '../../../ui/controls/action'
import { useTheme } from '../../../ui/theme'

export default function OpenThreadRoute() {
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  const { ready, overviews, activeId } = useRuntime()
  const { runtimeId, threadId } = useLocalSearchParams()
  const target =
    typeof runtimeId === 'string' && typeof threadId === 'string'
      ? parseStudioLink(threadReferenceLink(runtimeId, threadId))
      : undefined
  const href = target?.kind === 'thread' ? studioThreadHref(target, overviews, activeId) : undefined
  if (ready && href) return <Redirect href={href} />

  return (
    <View style={styles.screen}>
      {!ready ? (
        <ActivityIndicator accessibilityLabel={uiText('Opening thread…')} />
      ) : (
        <EmptyState
          icon="error"
          title={uiText('Could not open link')}
          description={
            target
              ? uiText('This thread’s computer is no longer paired.')
              : uiText('This thread link is invalid.')
          }
          action={<Action label={uiText('Go to threads')} onPress={() => router.replace('/')} />}
        />
      )}
    </View>
  )
}
