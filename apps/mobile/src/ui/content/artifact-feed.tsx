import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { Alert, ScrollView, View } from 'react-native'
import type { AccountClient, Artifact, OpenShare } from '@dovo/protocol'
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
  encryptedShare,
  onShareChange,
}: {
  artifact: Artifact
  publicationId: string
  origin: string
  client: AccountClient
  encryptedShare?: OpenShare
  onShareChange?: (share: OpenShare) => void
}) {
  const uiText = useInterfaceText()

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
    encryptedShare,
    onShareChange,
  })
  return (
    <View
      style={{ ...styles.card, gap: 12, padding: 16 }}
      accessibilityLabel={uiText('Live MCP data feed')}
    >
      <Text accessibilityRole="header" style={{ ...styles.text, fontWeight: '600' }}>
        <InterfaceText>{'Live MCP data'}</InterfaceText>
      </Text>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Approve one fixed read query for this published version. This computer supplies the data; viewers cannot call tools or change the query. Read-only declarations are not a security guarantee: use a trusted server and read-only credentials.'
          }
        </InterfaceText>
      </Text>
      <Action
        secondary
        label={uiText('Load read-only MCP tools')}
        disabled={feed.busy || !connected}
        onPress={() => void feed.load()}
      />
      {feed.tools && !feed.tools.length && (
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'No eligible tools. Configure a read-only MCP server in this thread’s project or agent resources.'
            }
          </InterfaceText>
        </Text>
      )}
      {!!feed.tools?.length && (
        <>
          <Choice
            label={uiText('MCP query')}
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
            label={uiText('Query arguments (JSON)')}
            value={feed.argumentsText}
            multiline
            autoCorrect={false}
            editable={!feed.busy}
            onChangeText={feed.setArguments}
          />
          <Field
            label={uiText('JSON field to share')}
            value={feed.pointer}
            placeholder="/summary (empty shares the whole value)"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!feed.busy}
            onChangeText={feed.setPointer}
          />
          <Choice
            label={uiText('Refresh interval')}
            value={String(feed.seconds)}
            disabled={feed.busy}
            onChange={(value) => feed.setSeconds(Number(value))}
            items={[
              { id: '60', name: uiText('1 minute') },
              { id: '300', name: uiText('5 minutes') },
              { id: '900', name: uiText('15 minutes') },
            ]}
          />
          <Action
            secondary
            label={uiText('Read preview')}
            disabled={feed.busy || !connected}
            onPress={() => void feed.read()}
          />
        </>
      )}
      {feed.plan && (
        <>
          <Text style={styles.muted}>
            <InterfaceText>
              {
                'Review the exact selected data. Enabling shares this value and future results with all invited accounts and anyone holding a shareable link.'
              }
            </InterfaceText>
          </Text>
          <ScrollView style={{ maxHeight: 200 }}>
            <Text selectable accessibilityLabel={uiText('Selected feed data')} style={styles.text}>
              {JSON.stringify(feed.plan.data, null, 2)}
            </Text>
          </ScrollView>
          <Action
            label={uiText('Approve and enable live feed')}
            disabled={feed.busy || !connected}
            onPress={() =>
              Alert.alert(
                uiText('Approve live data feed?'),
                uiText(
                  'Allow {value0} / {value1} to run every {value2} minute(s) using this computer’s MCP access, and upload the selected data to {value3}? Every invited account or share-link holder can view future results. This replaces the current feed.',
                  {
                    value0: feed.target?.server,
                    value1: feed.target?.tool,
                    value2: feed.seconds / 60,
                    value3: origin,
                  },
                ),
                [
                  { text: uiText('Cancel'), style: 'cancel' },
                  { text: uiText('Approve live feed'), onPress: () => void feed.enable() },
                ],
              )
            }
          />
        </>
      )}
      {feed.status.enabled && (
        <>
          <Text style={styles.muted}>
            <InterfaceText>
              {
                'Live feed enabled. This runtime must stay online. Cached data remains available until the hosted feed is cleared.'
              }
            </InterfaceText>
          </Text>
          <Action
            secondary
            label={uiText('Stop and clear live feed')}
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
