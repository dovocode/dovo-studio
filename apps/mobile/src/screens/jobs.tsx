import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { runtimeComputerName, runtimeReachability, runtimeResourceKey } from '@dovo/protocol'
import { nativeEffect } from '../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/state/application-state'
import { AutomationRow } from '../jobs/automation-row'
import { automationRowState } from '../jobs/automation-summary'
import { useRef } from 'react'
import { FlatList, Keyboard, Switch, View } from 'react-native'
import { router } from 'expo-router'
import { Text } from '../ui/content/text'
import { useRuntime } from '../runtime/connection/provider'
import { useSettingsTheme as useTheme, SettingsPage } from './settings-theme'
import { CreationTarget } from '../runtime/connection/creation-target'
import { SettingsSearchField as SearchField } from './settings-controls'
import { AutomationEditor } from '../jobs/automation-editor'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Action } from '../ui/controls/action'
import { EmptyState } from '../ui/content/empty-state'
import { useListScroll } from '../ui/layout/use-list-scroll'
import { automationHref } from '../shell/source-route'
import { useNavigation } from '../shell/navigation'
export default function JobsScreen() {
  const uiText = useInterfaceText()

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
  const incompleteSources = overviews.filter(
    (entry) => !entry.connected || entry.error || !entry.snapshot,
  )
  const loading = refreshing || overviews.some((entry) => !entry.snapshot && !entry.error)
  const available = overviews.some((entry) => entry.connected && !entry.error && entry.snapshot)
  const { focused } = useNavigation()
  const [creating, setCreating] = useApplicationState(false)
  const [query, setQuery] = useApplicationState('')
  const [attentionOnly, setAttentionOnly] = useApplicationState(false)
  const flows = overviews.flatMap((entry) =>
    entry.snapshot
      ? entry.snapshot.workspace.automations.map((flow) => ({
          flow,
          snapshot: entry.snapshot!,
          state: automationRowState(flow.id, entry.snapshot!),
          runtimeId: entry.profile.id,
          runtimeName: runtimeComputerName(entry),
          reachability: runtimeReachability(entry),
          key: runtimeResourceKey(entry.profile.id, flow.id),
        }))
      : [],
  )
  const visible = flows.filter(
    (item) =>
      (!attentionOnly || item.state.needsAttention) &&
      [item.flow.name, item.runtimeName].some((value) =>
        value.toLowerCase().includes(query.trim().toLowerCase()),
      ),
  )
  const unavailable = overviews.length > 0 && !available && !flows.length
  const filtering = !!query.trim() || attentionOnly
  const scrollOffset = useRef(0)
  const { retainPosition, ...listScroll } = useListScroll<(typeof flows)[number]>(
    scrollOffset,
    focused,
  )
  return (
    <SettingsPage>
      <ScreenHeader
        title={uiText('Automations')}
        testID="Automations heading"
        buttons={[
          {
            label: uiText('New automation'),
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
            {incompleteSources.map((entry) => {
              const reachability = runtimeReachability(entry)
              const status =
                reachability === 'offline'
                  ? entry.snapshot
                    ? uiText('Offline · Showing saved automations')
                    : uiText('Offline')
                  : reachability === 'connecting' || (!entry.snapshot && !entry.error)
                    ? uiText('Connecting…')
                    : undefined
              return (
                <Text
                  key={entry.profile.id}
                  accessibilityRole={entry.error ? 'alert' : undefined}
                  style={entry.error ? styles.error : styles.muted}
                >
                  {[runtimeComputerName(entry), status, entry.error].filter(Boolean).join(' · ')}
                </Text>
              )
            })}
            {(refreshError || incompleteSources.some((entry) => entry.error)) && (
              <Action
                secondary
                label={uiText('Retry loading automations')}
                disabled={refreshing}
                onPress={refresh}
              />
            )}
            <Text style={styles.muted}>
              <InterfaceText>{'All computers'}</InterfaceText>
            </Text>
            <SearchField
              label={uiText('Search automations')}
              placeholder={uiText('Search automations')}
              value={query}
              onChangeText={setQuery}
            />
            <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.text}>{uiText('Needs attention')}</Text>
              <Switch
                accessibilityLabel={uiText('Needs attention')}
                value={attentionOnly}
                onValueChange={setAttentionOnly}
                hitSlop={8}
              />
            </View>
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
              reachability={item.reachability}
              state={item.state}
              disabled={!focused}
              onOpenRun={(runId) => {
                if (!focused) return
                retainPosition()
                Keyboard.dismiss()
                router.push(automationHref(item.runtimeId, item.flow.id, runId))
              }}
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
          loading ? (
            <Text accessibilityLiveRegion="polite" style={styles.muted}>
              {uiText('Loading automations…')}
            </Text>
          ) : (
            <EmptyState
              icon="jobs"
              title={
                !overviews.length
                  ? uiText('Connect a computer')
                  : unavailable
                    ? uiText('Automations unavailable')
                    : filtering
                      ? uiText('No matching automations.')
                      : incompleteSources.length
                        ? uiText('No automations on available computers')
                        : uiText('Create an automation')
              }
              description={
                !overviews.length
                  ? uiText('Connect a computer to load its automations.')
                  : unavailable
                    ? uiText('Reconnect a computer to load its automations.')
                    : incompleteSources.length
                      ? uiText('Some computers could not be checked.')
                      : filtering
                        ? uiText('Search by automation or computer.')
                        : uiText(
                            'Run repeatable tasks manually or on a schedule, with review steps when you need them.',
                          )
              }
              action={
                !overviews.length ? (
                  <Action
                    label={uiText('Connect a computer')}
                    disabled={!focused}
                    onPress={() =>
                      router.push({ pathname: '/settings/devices', params: { pair: '1' } })
                    }
                  />
                ) : filtering && !unavailable ? (
                  <Action
                    secondary
                    label={uiText('Clear search')}
                    onPress={() => {
                      setQuery('')
                      setAttentionOnly(false)
                    }}
                  />
                ) : !incompleteSources.length ? (
                  <Action
                    label={uiText('New automation')}
                    disabled={!focused || !connected}
                    onPress={() => setCreating(true)}
                  />
                ) : undefined
              }
            />
          )
        }
      />
      {creating && (
        <CreationTarget title={uiText('New automation')} onClose={() => setCreating(false)}>
          {() => <AutomationEditor onClose={() => setCreating(false)} />}
        </CreationTarget>
      )}
    </SettingsPage>
  )
}
