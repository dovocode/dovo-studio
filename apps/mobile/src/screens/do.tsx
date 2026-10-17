import { ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { runtimeComputerName } from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { useApplicationState } from '../runtime/state/application-state'
import { useNavigation } from '../shell/navigation'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
import { useTheme } from '../ui/theme'
import { DoChatComposer } from '../do/chat-composer'
import { doPlansHref } from '../do/route'

export default function DoScreen() {
  const { styles } = useTheme()
  const { overviews, activeId } = useRuntime()
  const { focused } = useNavigation()
  const enabled = overviews.filter((entry) => entry.snapshot?.doEnabled)
  const [selected, setSelected] = useApplicationState(
    () =>
      enabled.find((entry) => entry.profile.id === activeId)?.profile.id ??
      enabled[0]?.profile.id ??
      '',
  )
  const currentId = enabled.some((entry) => entry.profile.id === selected)
    ? selected
    : (enabled[0]?.profile.id ?? '')
  const current = enabled.find((entry) => entry.profile.id === currentId)
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Do (experimental)"
        buttons={
          current
            ? [
                {
                  label: 'Review plans',
                  icon: 'jobs',
                  onPress: () => router.push(doPlansHref(currentId)),
                },
              ]
            : []
        }
      />
      <ScrollView
        contentContainerStyle={[styles.content, { flexGrow: 1, gap: 24, paddingTop: 32 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {!enabled.length ? (
          <View style={styles.card}>
            <Text style={styles.text}>Enable Do on a computer to get started.</Text>
            <Action
              label="Open computer preferences"
              onPress={() => router.push('/settings/devices')}
            />
          </View>
        ) : enabled.length > 1 ? (
          <Choice
            label="Computer"
            value={currentId}
            items={enabled.map((entry) => ({
              id: entry.profile.id,
              name: `${runtimeComputerName(entry)}${entry.connected ? '' : ' · Offline'}`,
            }))}
            onChange={setSelected}
          />
        ) : current ? (
          <Text style={styles.muted}>{runtimeComputerName(current)}</Text>
        ) : null}
        {enabled.map((entry) => (
          <View
            key={entry.profile.id}
            style={{ display: entry.profile.id === currentId ? 'flex' : 'none' }}
          >
            <RuntimeScope runtimeId={entry.profile.id}>
              <DoChatComposer active={focused && entry.profile.id === currentId} />
            </RuntimeScope>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}
