import { runtimeComputerName } from '@dovo/protocol'
import { nativeEffect } from '../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/state/application-state'
import { AutomationRow } from '../jobs/automation-row'
import { useRef } from 'react'
import { FlatList, Keyboard, View } from 'react-native'
import { router } from 'expo-router'
import { Text } from '../ui/content/text'
import { useRuntime } from '../runtime/connection/provider'
import { useSettingsTheme as useTheme, SettingsPage } from './settings-theme'
import { CreationTarget } from '../runtime/connection/creation-target'
import { SettingsSearchField as SearchField } from './settings-controls'
import { AutomationEditor } from '../jobs/automation-editor'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Action } from '../ui/controls/action'
import { Icon } from '../ui/controls/icon'
import { useListScroll } from '../ui/layout/use-list-scroll'
import { automationHref } from '../shell/source-route'
import { useNavigation } from '../shell/navigation'
export default function JobsScreen() {
  const { colors, styles } = useTheme()

  const { overviews, refreshAll } = useRuntime()
  const connected = overviews.some((entry) => entry.connected)
  const [refreshing, setRefreshing] = useApplicationState(false)
  const [refreshError, setRefreshError] = useApplicationState('')
  const refresh = () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshError('')
    void runClientEffect(
      nativeEffect(() => refreshAll()).pipe(
        Effect.catch((cause) =>
          Effect.sync(() =>
            setRefreshError(cause instanceof Error ? cause.message : String(cause)),
          ),
        ),
        Effect.ensuring(Effect.sync(() => setRefreshing(false))),
      ),
    )
  }
  const failedSources = overviews.filter((entry) => entry.error || !entry.connected)
  const { focused } = useNavigation()
  const [creating, setCreating] = useApplicationState(false)
  const [query, setQuery] = useApplicationState('')
  const flows = overviews.flatMap((entry) =>
    entry.snapshot
      ? entry.snapshot.workspace.automations.map((flow) => ({
          flow,
          snapshot: entry.snapshot!,
          runtimeId: entry.profile.id,
          runtimeName: runtimeComputerName(entry),
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
    <SettingsPage>
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
        onRefresh={refresh}
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
            {!!refreshError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {refreshError}
              </Text>
            )}
            {failedSources.map((entry) => (
              <Text
                key={entry.profile.id}
                accessibilityRole={entry.error ? 'alert' : undefined}
                style={entry.error ? styles.error : styles.muted}
              >
                {runtimeComputerName(entry)} ·{' '}
                {entry.error || 'Offline · Showing saved automations'}
              </Text>
            ))}
            {(refreshError || failedSources.length > 0) && (
              <Action
                secondary
                label="Retry loading automations"
                disabled={refreshing}
                onPress={refresh}
              />
            )}
            <Text style={styles.muted}>All computers</Text>
            <SearchField
              label="Search automations"
              placeholder="Search automations"
              value={query}
              onChangeText={setQuery}
            />
          </View>
        }
        renderItem={({ item, index }) => (
          <View
            style={{
              backgroundColor: colors.surface,
              paddingHorizontal: 16,
              borderTopLeftRadius: index === 0 ? 24 : 0,
              borderTopRightRadius: index === 0 ? 24 : 0,
              borderBottomLeftRadius: index === visible.length - 1 ? 24 : 0,
              borderBottomRightRadius: index === visible.length - 1 ? 24 : 0,
              overflow: 'hidden',
            }}
          >
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
          </View>
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
                {connected ? 'Create an automation' : 'Connect a computer'}
              </Text>
              <Text
                style={[
                  styles.muted,
                  {
                    textAlign: 'center',
                  },
                ]}
              >
                {connected
                  ? 'Run repeatable tasks manually or on a schedule, with review steps when you need them.'
                  : 'Reconnect a computer to load its automations.'}
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
    </SettingsPage>
  )
}
