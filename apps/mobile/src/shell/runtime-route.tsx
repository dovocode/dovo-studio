import { Fragment, type ReactNode } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'
import { useNavigation } from './navigation'
import { backToCollection } from './source-route'

/** A route never mounts requests or mutations against a different computer's matching IDs. */
type RuntimeRouteProps = {
  runtimeId: string
  repositoryId?: string
  jiraSourceId?: string
  title: string
  backTo: '/issues' | '/pulls' | '/settings/automations'
  children: ReactNode
}
export function RuntimeRoute(props: RuntimeRouteProps) {
  const { overviews } = useRuntime()
  return overviews.some((entry) => entry.profile.id === props.runtimeId) ? (
    <RuntimeScope runtimeId={props.runtimeId}>
      <RuntimeRouteContent {...props} />
    </RuntimeScope>
  ) : (
    <RuntimeRouteContent {...props} />
  )
}
function RuntimeRouteContent({
  runtimeId,
  repositoryId,
  jiraSourceId,
  title,
  backTo,
  children,
}: RuntimeRouteProps) {
  const { colors, styles } = useTheme()

  const { ready, activeId, profiles, snapshot, refresh, refreshRuntime, connected } = useRuntime()
  const { focused, navigate } = useNavigation()
  const { busy, error, act } = useAction()
  const owner = profiles.find((profile) => profile.id === runtimeId)
  const project = snapshot?.workspace.repositories.find(
    (repository) => repository.id === repositoryId,
  )
  const jiraSource = snapshot?.workspace.jiraSources?.find((source) => source.id === jiraSourceId)
  const projectExists =
    (repositoryId === undefined || !!project) && (jiraSourceId === undefined || !!jiraSource)
  if (ready && owner && activeId === runtimeId && snapshot && projectExists)
    return (
      <Fragment
        key={JSON.stringify([
          runtimeId,
          project?.id,
          project?.path,
          project?.forge,
          project?.jira,
          jiraSource,
        ])}
      >
        {children}
      </Fragment>
    )

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={title}
        subtitle={owner?.name}
        leading={<Action secondary label="Back" onPress={() => backToCollection(backTo)} />}
      />
      <View style={styles.content}>
        {!ready ? (
          <ActivityIndicator color={colors.accent} />
        ) : !owner ? (
          <>
            <Text style={styles.title}>Computer unavailable</Text>
            <Text style={styles.muted}>
              This link belongs to a computer that is no longer saved on this device.
            </Text>
            <Action label="Open computer settings" onPress={() => navigate('settings')} />
          </>
        ) : activeId !== runtimeId ? (
          <>
            <Text style={styles.title}>Loading saved connection…</Text>
            <Action
              label="Refresh connection"
              disabled={busy || !focused}
              onPress={() => act(() => refreshRuntime(owner))}
            />
          </>
        ) : (
          <>
            <Text style={styles.title}>
              {snapshot
                ? jiraSourceId
                  ? 'Jira source unavailable'
                  : 'Project unavailable'
                : 'Loading workspace…'}
            </Text>
            <Text style={styles.muted}>
              {snapshot
                ? 'This source may have been removed. Return to the list or refresh this computer.'
                : 'Waiting for this computer’s workspace. Saved details remain available offline.'}
            </Text>
            <Action
              label={connected ? 'Refresh workspace' : 'Reconnect'}
              disabled={busy || !focused}
              onPress={() => act(refresh)}
            />
          </>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </View>
    </View>
  )
}
