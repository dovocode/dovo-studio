import { nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import { AutomationRow } from '../jobs/automation-row'
import { useRef } from 'react'
import { FlatList, Keyboard, View } from 'react-native'
import { router } from 'expo-router'
import { Text } from '../ui/text'
import { useRuntime } from '../runtime/provider'
import { styles, colors } from '../ui/theme'
import { CreationTarget } from '../runtime/creation-target'
import { SearchField } from '../ui/field'
import { AutomationEditor } from '../jobs/automation-editor'
import { ScreenHeader } from '../ui/screen-header'
import { Icon } from '../ui/icon'
import { useListScroll } from '../ui/use-list-scroll'
import { automationHref } from '../shell/source-route'
import { useNavigation } from '../shell/navigation'
export default function JobsScreen() {
  const { overviews, refreshAll } = useRuntime()
  const connected = overviews.some((entry) => entry.connected)
  const [refreshing, setRefreshing] = useApplicationState(false)
  const { focused } = useNavigation()
  const [creating, setCreating] = useApplicationState(false)
  const [query, setQuery] = useApplicationState('')
  const flows = overviews.flatMap((entry) =>
    entry.snapshot
      ? entry.snapshot.workspace.automations.map((flow) => ({
          flow,
          snapshot: entry.snapshot!,
          runtimeId: entry.profile.id,
          runtimeName: entry.profile.name,
          connected: entry.connected,
          key: JSON.stringify([entry.profile.id, flow.id]),
        }))
      : [],
  )
  const visible = flows.filter((item) =>
    [item.flow.name, item.runtimeName].some((value) =>
      value.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  )
  const scrollOffset = useRef(0)
  const { retainPosition, ...listScroll } = useListScroll<(typeof flows)[number]>(
    scrollOffset,
    focused,
  )
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Automations"
        testID="Automations heading"
        buttons={[
          {
            label: 'New automation',
            icon: 'add',
            disabled: !focused || !connected,
            onPress: () => setCreating(true),
          },
        ]}
      />
      <FlatList
        {...listScroll}
        testID="Automation list"
        data={visible}
        keyExtractor={(item) => item.key}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true)
          void runClientEffect(
            nativeEffect(() => refreshAll()).pipe(
              Effect.ensuring(nativeEffect(() => setRefreshing(false)).pipe(Effect.orDie)),
            ),
          )
        }}
        scrollEventThrottle={32}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: 0,
            gap: 0,
            flexGrow: 1,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View
            style={{
              gap: 8,
              paddingBottom: 8,
            }}
          >
            <Text style={styles.muted}>All computers</Text>
            <SearchField
              label="Search automations"
              placeholder="Search automations"
              value={query}
              onChangeText={setQuery}
            />
          </View>
        }
        renderItem={({ item }) => (
          <AutomationRow
            flow={item.flow}
            snapshot={item.snapshot}
            runtimeName={item.runtimeName}
            online={item.connected}
            disabled={!focused}
            onOpen={() => {
              if (!focused) return
              retainPosition()
              Keyboard.dismiss()
              router.push(automationHref(item.runtimeId, item.flow.id))
            }}
          />
        )}
        ListEmptyComponent={
          !flows.length ? (
            <View
              style={[
                styles.empty,
                {
                  paddingVertical: 36,
                },
              ]}
            >
              <Icon name="jobs" size={28} color={colors.muted} />
              <Text
                style={[
                  styles.title,
                  {
                    fontSize: 18,
                  },
                ]}
              >
                Create an automation
              </Text>
              <Text
                style={[
                  styles.muted,
                  {
                    textAlign: 'center',
                  },
                ]}
              >
                Run repeatable tasks manually or on a schedule, with review steps when you need
                them.
              </Text>
            </View>
          ) : (
            <Text style={styles.muted}>No matching automations.</Text>
          )
        }
      />
      {creating && (
        <CreationTarget title="New automation" onClose={() => setCreating(false)}>
          {() => <AutomationEditor onClose={() => setCreating(false)} />}
        </CreationTarget>
      )}
    </View>
  )
}
