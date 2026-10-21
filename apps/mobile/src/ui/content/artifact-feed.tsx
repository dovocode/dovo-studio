import { Alert, ScrollView, View } from 'react-native'
import type { AccountClient, Artifact } from '@dovo/protocol'
import { useArtifactFeed } from '@dovo/studio-core'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../controls/action'
import { Field } from '../controls/field'
import { Choice } from '../controls/choice'
import { Text } from './text'
import { useTheme } from '../theme'

export function ArtifactFeedSetup({
  artifact,
  publicationId,
  origin,
  client,
}: {
  artifact: Artifact
  publicationId: string
  origin: string
  client: AccountClient
}) {
  const { call, connected, activeId } = useRuntime(),
    { styles } = useTheme()
  const feed = useArtifactFeed({
    artifact,
    publicationId,
    origin,
    client,
    runtimeId: activeId,
    request: call,
    connected,
  })
  return (
    <View style={{ gap: 10, paddingVertical: 12 }} accessibilityLabel="Live MCP data feed">
      <Text style={styles.title}>Live MCP data</Text>
      <Text style={styles.muted}>
        Approve one fixed read query for this published version. This computer supplies the data;
        viewers cannot call tools or change the query. Read-only declarations are not a security
        guarantee: use a trusted server and read-only credentials.
      </Text>
      <Action
        secondary
        label="Load read-only MCP tools"
        disabled={feed.busy || !connected}
        onPress={() => void feed.load()}
      />
      {feed.tools && !feed.tools.length && (
        <Text style={styles.muted}>
          No eligible tools. Configure a read-only MCP server in this thread’s project or agent
          resources.
        </Text>
      )}
      {!!feed.tools?.length && (
        <>
          <Choice
            label="MCP query"
            value={feed.selection}
            disabled={feed.busy}
            onChange={feed.setSelection}
            items={feed.tools.map((tool, index) => ({
              id: String(index),
              name: `${tool.server} / ${tool.tool}`,
            }))}
          />
          {feed.target && (
            <ScrollView style={{ maxHeight: 140 }}>
              <Text selectable style={styles.muted}>
                {feed.target.description}
                {'\n'}
                {JSON.stringify(feed.target.inputSchema, null, 2)}
              </Text>
            </ScrollView>
          )}
          <Field
            label="Query arguments (JSON)"
            value={feed.argumentsText}
            multiline
            autoCorrect={false}
            editable={!feed.busy}
            onChangeText={feed.setArguments}
          />
          <Field
            label="JSON field to share"
            value={feed.pointer}
            placeholder="/summary (empty shares the whole value)"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!feed.busy}
            onChangeText={feed.setPointer}
          />
          <Choice
            label="Refresh interval"
            value={String(feed.seconds)}
            disabled={feed.busy}
            onChange={(value) => feed.setSeconds(Number(value))}
            items={[
              { id: '60', name: '1 minute' },
              { id: '300', name: '5 minutes' },
              { id: '900', name: '15 minutes' },
            ]}
          />
          <Action
            secondary
            label="Read preview"
            disabled={feed.busy || !connected}
            onPress={() => void feed.read()}
          />
        </>
      )}
      {feed.plan && (
        <>
          <Text style={styles.muted}>
            Review the exact selected data. Enabling shares this value and future results with all
            invited accounts and anyone holding a shareable link.
          </Text>
          <ScrollView style={{ maxHeight: 200 }}>
            <Text selectable accessibilityLabel="Selected feed data" style={styles.text}>
              {JSON.stringify(feed.plan.data, null, 2)}
            </Text>
          </ScrollView>
          <Action
            label="Approve and enable live feed"
            disabled={feed.busy || !connected}
            onPress={() =>
              Alert.alert(
                'Approve live data feed?',
                `Allow ${feed.target?.server} / ${feed.target?.tool} to run every ${feed.seconds / 60} minute(s) using this computer’s MCP access, and upload the selected data to ${origin}? Every invited account or share-link holder can view future results. This replaces the current feed.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Approve live feed', onPress: () => void feed.enable() },
                ],
              )
            }
          />
        </>
      )}
      {feed.status.enabled && (
        <>
          <Text style={styles.muted}>
            Live feed enabled. This runtime must stay online. Cached data remains available until
            the hosted feed is cleared.
          </Text>
          <Action
            secondary
            label="Stop and clear live feed"
            disabled={feed.busy || !connected}
            onPress={() => void feed.stop()}
          />
        </>
      )}
      {!!(feed.error || feed.status.error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {feed.error || feed.status.error}
        </Text>
      )}
    </View>
  )
}
