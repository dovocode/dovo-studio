import { useContext } from 'react'
import { Alert, View } from 'react-native'
import {
  SCRATCH_PROJECT_ID,
  type StudioDataSource,
  type dashboardReadResultSchema,
} from '@dovo/protocol'
import { useStudioDataSource } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../runtime/connection/provider'
import { useAppActive } from '../runtime/state/app-active'
import { NavigationContext } from '../shell/navigation'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'
import { DataView } from './dashboard-data-view'

export function MobileDataSource({
  source,
  read,
  onData,
}: {
  source: StudioDataSource & { title: string }
  read: () => Promise<typeof dashboardReadResultSchema.Type>
  onData?: (value: unknown) => void
}) {
  const uiText = useInterfaceText()
  const { connected, snapshot } = useRuntime()
  const focused = useContext(NavigationContext)?.focused ?? true
  const foreground = useAppActive()
  const supported =
    (source.kind === 'api' && source.refreshSeconds === undefined && !source.panels) ||
    snapshot?.studioDataSourcesSupported === true
  const active = connected && focused && foreground && supported
  const state = useStudioDataSource(source.refreshSeconds, active, read, onData)
  const project =
    source.kind === 'cli'
      ? (snapshot?.workspace.repositories.find((entry) => entry.id === source.repositoryId)?.name ??
        (source.repositoryId === SCRATCH_PROJECT_ID ? uiText('No Project') : source.repositoryId))
      : undefined
  const detail = source.kind === 'cli' ? source.command : source.url
  const confirm = (title: string, run: () => void) => {
    if (source.kind === 'api') run()
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
        {source.refreshSeconds !== undefined && (
          <Action
            label={
              state.running
                ? uiText('Stop auto refresh')
                : uiText('Start auto refresh ({seconds}s)', { seconds: source.refreshSeconds })
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
                      seconds: source.refreshSeconds,
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
      {state.error && <Text accessibilityRole="alert">{state.error}</Text>}
      {state.data && (
        <>
          <Text>
            {uiText('Updated {time}', {
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
