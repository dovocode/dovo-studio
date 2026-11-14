import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { configureSharingRandom } from '@dovo/protocol'
import { createSharingFixture } from '../../../design-system/src/sharing-fixture'
import { MobileAccountContext } from '../runtime/connection/account-context'
import { ThreadSuggestions } from '../ui/content/thread-suggestions'
import { SharingPanel } from '../ui/content/sharing-panel'
import { Sheet } from '../ui/layout/sheet'
import { Action } from '../ui/controls/action'
import { useTheme } from '../ui/theme'
import { Text } from '../ui/content/text'
import { View } from 'react-native'
configureSharingRandom((array) => Crypto.getRandomValues(array))
export function SharingExample({
  published = true,
  kind = 'thread',
  offline = false,
}: {
  published?: boolean
  kind?: 'thread' | 'artifact'
  offline?: boolean
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const [fixture] = useState(() => createSharingFixture({ kind, withKey: published })),
    [ready, setReady] = useState(false),
    [draft, setDraft] = useState('Existing draft'),
    [open, setOpen] = useState(false),
    [failed, setFailed] = useState(false)
  useEffect(() => {
    void fixture.ready(published).then(() => setReady(true))
  }, [fixture, published])
  if (!ready)
    return (
      <Text style={styles.text}>
        <InterfaceText>{'Preparing sharing example…'}</InterfaceText>
      </Text>
    )
  return (
    <MobileAccountContext.Provider value={{ ...fixture.client.snapshot(), client: fixture.client }}>
      <View style={{ gap: 16 }}>
        {kind === 'thread' && (
          <ThreadSuggestions
            client={fixture.client}
            sourceId={fixture.sourceId}
            onUseSuggestion={(text) =>
              setDraft((previous) => [previous, text].filter(Boolean).join('\n\n'))
            }
          />
        )}
        <Action label={uiText('Manage sharing')} onPress={() => setOpen(true)} />
        {open && (
          <Sheet title={uiText('Share {value0}', { value0: kind })} onClose={() => setOpen(false)}>
            <Action
              secondary
              label={failed ? uiText('Restore connection') : uiText('Simulate connection failure')}
              onPress={() => {
                fixture.fail(!failed)
                setFailed(!failed)
              }}
            />
            <SharingPanel
              sourceId={fixture.sourceId}
              kind={kind}
              content={kind === 'artifact' ? fixture.content : undefined}
              runtime={offline ? undefined : fixture.runtime}
            />
          </Sheet>
        )}
        {!!draft && (
          <Text style={styles.text}>
            <InterfaceText values={{ value0: draft }}>{'Composer draft: {value0}'}</InterfaceText>
          </Text>
        )}
      </View>
    </MobileAccountContext.Provider>
  )
}
