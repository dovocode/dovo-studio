import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import type {
  MarketplaceBinding,
  MarketplaceRelease,
  StudioExtensionCommand,
  StudioExtensionEntry,
} from '@dovo/protocol'
import {
  addMarketplaceDashboard,
  useExtensionMarketplace,
  useMarketplaceSources,
} from '@dovo/studio-core'
import { useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { Field } from '../ui/controls/field'
import { Choice } from '../ui/controls/choice'
import { Text } from '../ui/content/text'
import { Surface } from '../ui/layout/surface'

type SourceContribution = Extract<
  MarketplaceRelease['manifest']['contributions'][number],
  { kind: 'tool' | 'app' }
>
const card = { padding: 12, gap: 8, borderRadius: 10 }

export function ExtensionMarketplace({
  entries,
  busy,
  stage,
  review,
}: {
  entries: StudioExtensionEntry[]
  busy: boolean
  stage: (input: StudioExtensionCommand) => Promise<boolean>
  review: (entry: StudioExtensionEntry) => void
}) {
  const uiText = useInterfaceText()
  const { read, connected, snapshot } = useRuntime()
  const state = useExtensionMarketplace(
    read,
    connected,
    snapshot?.studioExtensionsRevision,
    entries,
  )
  const [dashboard, setDashboard] = useState<{ digest: string; issue?: string; added?: boolean }>()
  const [adding, setAdding] = useState(false)
  const selected = state.selected
  const release = state.release
  const current = entries.find((entry) => entry.id === selected?.id)
  const command = state.stage(current)
  return (
    <View style={{ gap: 8 }} accessibilityLabel={uiText('Extension marketplace')}>
      <Field
        label={uiText('Search extensions')}
        value={state.search.query}
        onChangeText={state.search.setQuery}
      />
      <Action
        label={uiText('Reload marketplace')}
        secondary
        disabled={!connected}
        onPress={state.reload}
      />
      {state.error && <Text accessibilityRole="alert">{state.error}</Text>}
      {!state.packages && !state.error && (
        <Text>
          {connected
            ? uiText('Loading marketplace…')
            : uiText('Connect this computer to browse the marketplace.')}
        </Text>
      )}
      {state.packages?.length === 0 && <Text>{uiText('No extensions match.')}</Text>}
      {state.packages?.map((entry) => (
        <Surface key={entry.digest} style={card}>
          <Text accessibilityRole="header">{entry.name}</Text>
          <Text>
            {entry.publisher} · {entry.version}
            {entry.installed?.digest === entry.digest &&
              (entries.find((item) => item.id === entry.id)?.enabled
                ? ` · ${uiText('Installed')}`
                : ` · ${uiText('Disabled')}`)}
          </Text>
          <Text>{entry.description}</Text>
          <Action
            label={uiText('Preview {name} {version}', { name: entry.name, version: entry.version })}
            secondary
            disabled={!connected}
            onPress={() => state.open(entry)}
          />
        </Surface>
      ))}
      {selected && (
        <Surface style={card}>
          <Text accessibilityRole="header">
            {selected.name} {selected.version}
          </Text>
          <Action label={uiText('Close preview')} secondary onPress={() => state.open(undefined)} />
          {!release && !state.error && <Text>{uiText('Loading package…')}</Text>}
          {release && (
            <>
              {release.manifest.contributions.map((item) => (
                <View key={item.id} style={{ gap: 8 }}>
                  <Text>{item.title}</Text>
                  {(item.kind === 'tool' || item.kind === 'app') && (
                    <SourceFields
                      contribution={item}
                      binding={state.binding(item.id)}
                      bind={state.bind}
                    />
                  )}
                </View>
              ))}
              {current?.draft ? (
                selected.draft?.digest === selected.digest ? (
                  <Action
                    label={uiText('Review staged draft')}
                    disabled={!connected || busy}
                    onPress={() => review(current)}
                  />
                ) : (
                  <Text>
                    {uiText('Review or discard the existing draft before staging this package.')}
                  </Text>
                )
              ) : (
                <Action
                  label={
                    selected.installed && selected.installed.digest !== selected.digest
                      ? uiText('Stage update')
                      : uiText('Stage package')
                  }
                  disabled={!command || !connected || busy}
                  onPress={async () => {
                    if (command && (await stage(command))) state.reload()
                  }}
                />
              )}
              {release.dashboard && snapshot?.dashboardsSupported && (
                <>
                  <Text>
                    {uiText('Dashboard template: {title}', { title: release.dashboard.title })}
                  </Text>
                  {current?.enabled && selected.installed?.digest === selected.digest ? (
                    dashboard?.digest === selected.digest && dashboard.added ? (
                      <Action
                        label={uiText('Open dashboards')}
                        secondary
                        onPress={() => router.navigate('/dashboards')}
                      />
                    ) : (
                      <Action
                        label={uiText('Add dashboard')}
                        secondary
                        disabled={!connected || adding}
                        onPress={async () => {
                          setAdding(true)
                          try {
                            await addMarketplaceDashboard(read, release)
                            setDashboard({ digest: selected.digest, added: true })
                          } catch (cause) {
                            setDashboard({
                              digest: selected.digest,
                              issue: cause instanceof Error ? cause.message : String(cause),
                            })
                          } finally {
                            setAdding(false)
                          }
                        }}
                      />
                    )
                  ) : (
                    <Text>{uiText('Install and enable this release to add its dashboard.')}</Text>
                  )}
                  {dashboard?.digest === selected.digest && dashboard.issue && (
                    <Text accessibilityRole="alert">{dashboard.issue}</Text>
                  )}
                </>
              )}
            </>
          )}
        </Surface>
      )}
    </View>
  )
}

function SourceFields({
  contribution,
  binding,
  bind,
}: {
  contribution: SourceContribution
  binding?: MarketplaceBinding
  bind: (binding: MarketplaceBinding) => void
}) {
  const uiText = useInterfaceText()
  const { read, connected, snapshot } = useRuntime()
  const taskId = binding?.taskId ?? ''
  const sources = useMarketplaceSources(read, taskId, connected)
  const items =
    contribution.kind === 'tool'
      ? sources?.data?.servers.map((name) => ({ id: name, name }))
      : sources?.data?.apps.map(({ id, title }) => ({ id, name: title }))
  return (
    <>
      <Choice
        label={uiText('Source thread for {title}', { title: contribution.title })}
        disabled={!connected}
        value={taskId}
        items={(snapshot?.workspace.tasks ?? [])
          .filter((task) => !task.archived && !task.archivedAt)
          .map((task) => ({ id: task.id, name: task.title }))}
        onChange={(value) => bind({ contributionId: contribution.id, taskId: value, source: '' })}
      />
      <Choice
        label={
          contribution.kind === 'tool'
            ? uiText('MCP server with read-only tool {tool}', { tool: contribution.tool })
            : uiText('Saved MCP App')
        }
        disabled={!connected || !items?.length}
        value={binding?.source ?? ''}
        items={items ?? []}
        onChange={(source) => bind({ contributionId: contribution.id, taskId, source })}
      />
      {items?.length === 0 && <Text>{uiText('No sources available in this thread.')}</Text>}
      {sources?.error && <Text accessibilityRole="alert">{sources.error}</Text>}
    </>
  )
}
