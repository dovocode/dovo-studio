import { useContext } from 'react'
import { Alert, View } from 'react-native'
import { SCRATCH_PROJECT_ID, type dashboardReadResultSchema } from '@dovo/protocol'
import {
  studioReadingKey,
  useStudioDataSource,
  useStudioSourcePolicy,
  type StudioReadingOwner,
  type StudioReadingSource,
} from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../runtime/connection/provider'
import { useAppActive } from '../runtime/state/app-active'
import { NavigationContext } from '../shell/navigation'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'
import { DataView } from './dashboard-data-view'

type Props = {
  source: StudioReadingSource
  owner: StudioReadingOwner
  revision?: number
  read: (automatic?: boolean) => Promise<typeof dashboardReadResultSchema.Type>
  onData?: (value: unknown) => void
}

export function MobileDataSource(props: Props) {
  const { connection, activeId, snapshot } = useRuntime()
  const { owner, source } = props
  const project =
    source.kind === 'cli'
      ? snapshot?.workspace.repositories.find((entry) => entry.id === source.repositoryId)
      : undefined
  const identity = studioReadingKey(
    connection,
    snapshot?.runtimeId ?? activeId,
    owner,
    source,
    project?.path,
  )
  const seconds = 'refreshSeconds' in source ? source.refreshSeconds : undefined
  return (
    <MobileDataSourceView
      key={JSON.stringify([identity, seconds])}
      {...props}
      identity={identity}
      projectName={project?.name}
    />
  )
}

function MobileDataSourceView({
  source,
  owner,
  revision,
  read,
  onData,
  identity,
  projectName,
}: Props & { identity: string; projectName?: string }) {
  const uiText = useInterfaceText()
  const { connected, snapshot, read: request } = useRuntime()
  const focused = useContext(NavigationContext)?.focused ?? true
  const foreground = useAppActive()
  const seconds = 'refreshSeconds' in source ? source.refreshSeconds : undefined
  const supported =
    source.kind === 'mcp' ||
    (source.kind === 'api' && seconds === undefined && !source.panels) ||
    snapshot?.studioDataSourcesSupported === true
  const active = connected && focused && foreground && supported
  const policy = useStudioSourcePolicy(
    request,
    connected && !!snapshot?.studioSourcePoliciesSupported,
    owner,
    revision,
    source.id,
  )
  const autoLoad = !!policy.policy?.autoLoad
  const state = useStudioDataSource(identity, source, active, read, onData, undefined, autoLoad)
  const project =
    source.kind === 'cli'
      ? (projectName ??
        (source.repositoryId === SCRATCH_PROJECT_ID ? uiText('No Project') : source.repositoryId))
      : undefined
  const detail =
    source.kind === 'cli'
      ? source.command
      : source.kind === 'api'
        ? source.url
        : `${source.server} · ${source.tool}`
  const confirm = (title: string, run: () => void) => {
    if (source.kind !== 'cli') run()
    else
      Alert.alert(title, source.command, [
        { text: uiText('Cancel'), style: 'cancel' },
        { text: uiText('Run'), onPress: run },
      ])
  }
  return (
    <View style={{ gap: 8 }}>
      {onData && <Text accessibilityRole="header">{source.title}</Text>}
      {project && <Text>{project}</Text>}
      <Text selectable>{detail}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Action
          label={
            state.busy
              ? uiText('Reading…')
              : source.kind === 'cli'
                ? uiText('Run command')
                : uiText('Refresh data')
          }
          secondary
          disabled={!active || state.busy}
          onPress={() =>
            confirm(
              uiText('Run this command in {project}?', { project }),
              () => void state.refresh(),
            )
          }
        />
        {policy.policy && (
          <Action
            label={uiText(autoLoad ? 'Disable load on open' : 'Load on open')}
            secondary
            disabled={policy.saving}
            onPress={() => {
              if (autoLoad) void policy.save({ access: 'off', autoLoad: false })
              else if (source.kind !== 'cli')
                void policy.save({ access: 'persistent', autoLoad: true })
              else
                Alert.alert(
                  uiText('Enable automatic loading for this command?'),
                  `${project}\n${detail}${seconds ? `\n\n${uiText('Refresh every {seconds} seconds while open', { seconds })}` : ''}`,
                  [
                    { text: uiText('Cancel'), style: 'cancel' },
                    {
                      text: uiText('Load on open'),
                      onPress: () => void policy.save({ access: 'persistent', autoLoad: true }),
                    },
                  ],
                )
            }}
          />
        )}
        {seconds !== undefined && !autoLoad && (
          <Action
            label={
              state.running
                ? uiText('Stop auto refresh')
                : uiText('Start auto refresh ({seconds}s)', { seconds })
            }
            secondary
            disabled={!state.running && (!active || state.busy)}
            onPress={() => {
              if (state.running) state.stop()
              else
                confirm(
                  uiText(
                    'Run this command in {project} every {seconds} seconds while this tile is open?',
                    {
                      project,
                      seconds,
                    },
                  ),
                  state.start,
                )
            }}
          />
        )}
      </View>
      {!supported && (
        <Text>{uiText('Update the paired computer to use these data displays.')}</Text>
      )}
      {(state.error || policy.error) && (
        <Text accessibilityRole="alert">{state.error || policy.error}</Text>
      )}
      {state.data && (
        <>
          <Text>
            {uiText(state.stale ? 'Last result {time} · stale' : 'Updated {time}', {
              time: new Date(state.data.updatedAt).toLocaleTimeString(),
            })}
          </Text>
          {!onData && (
            <DataView value={state.data.data} chart={source.chart} panels={source.panels} />
          )}
        </>
      )}
    </View>
  )
}
