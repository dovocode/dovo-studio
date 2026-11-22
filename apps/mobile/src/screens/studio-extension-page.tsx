import { ScrollView, View } from 'react-native'
import { useStudioExtensionPage } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'
import { ScreenHeader } from '../ui/layout/screen-header'
import { ExtensionComponents } from './studio-extension-components'

export function StudioExtensionPage({
  runtimeId,
  extensionId,
  pageId,
}: {
  runtimeId?: string
  extensionId?: string
  pageId?: string
}) {
  const uiText = useInterfaceText()
  const { overviews } = useRuntime()
  if (
    !runtimeId ||
    !extensionId ||
    !pageId ||
    !overviews.some(({ profile }) => profile.id === runtimeId)
  )
    return (
      <>
        <ScreenHeader title={uiText('Extension page')} />
        <Text>{uiText('This extension page has no paired computer.')}</Text>
      </>
    )
  return (
    <RuntimeScope runtimeId={runtimeId}>
      <PageContent
        key={JSON.stringify([extensionId, pageId])}
        extensionId={extensionId}
        pageId={pageId}
      />
    </RuntimeScope>
  )
}

function PageContent({ extensionId, pageId }: { extensionId: string; pageId: string }) {
  const uiText = useInterfaceText()
  const { read, connected, snapshot, ready } = useRuntime()
  const state = useStudioExtensionPage(read, snapshot, connected, extensionId, pageId)
  const { entry, page } = state
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title={page?.title ?? uiText('Extension page')} />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        {!connected && <Text accessibilityRole="alert">{uiText('Computer offline.')}</Text>}
        {(state.error || state.message) && (
          <Text accessibilityRole="alert">{state.error || uiText(state.message)}</Text>
        )}
        {ready && entry && page && (
          <>
            <Text>{entry.installed?.name}</Text>
            <Action
              label={state.pinned ? uiText('Unpin from navigation') : uiText('Pin to navigation')}
              secondary
              disabled={!connected || state.busy}
              onPress={state.togglePin}
            />
            <ExtensionComponents
              entry={entry}
              contribution={page}
              save={(settings) => state.saveSettings(entry, settings)}
            />
          </>
        )}
      </ScrollView>
    </View>
  )
}
