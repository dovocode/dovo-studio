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
export function SharingExample({ published = true }: { published?: boolean }) {
  const { styles } = useTheme()
  const [fixture] = useState(createSharingFixture),
    [ready, setReady] = useState(false),
    [draft, setDraft] = useState('Existing draft'),
    [open, setOpen] = useState(false),
    [failed, setFailed] = useState(false)
  useEffect(() => {
    void fixture.ready(published).then(() => setReady(true))
  }, [fixture, published])
  if (!ready) return <Text style={styles.text}>Preparing sharing example…</Text>
  return (
    <MobileAccountContext.Provider value={{ ...fixture.client.snapshot(), client: fixture.client }}>
      <View style={{ gap: 16 }}>
        <ThreadSuggestions
          client={fixture.client}
          sourceId={fixture.sourceId}
          onUseSuggestion={(text) =>
            setDraft((previous) => [previous, text].filter(Boolean).join('\n\n'))
          }
        />
        <Action label="Manage sharing" onPress={() => setOpen(true)} />
        {open && (
          <Sheet title="Share thread" onClose={() => setOpen(false)}>
            <Action
              secondary
              label={failed ? 'Restore connection' : 'Simulate connection failure'}
              onPress={() => {
                fixture.fail(!failed)
                setFailed(!failed)
              }}
            />
            <SharingPanel
              sourceId={fixture.sourceId}
              kind="thread"
              runtime={fixture.runtime}
              onUseSuggestion={(text) => {
                setDraft(text)
                setOpen(false)
              }}
            />
          </Sheet>
        )}
        {!!draft && <Text style={styles.text}>Composer draft: {draft}</Text>}
      </View>
    </MobileAccountContext.Provider>
  )
}
