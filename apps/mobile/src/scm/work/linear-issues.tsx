import { useCallback, useState } from 'react'
import { Alert, Linking, View } from 'react-native'
import {
  linearIssuesSchema,
  linearIssueSources,
  runtimeComputerName,
  type RuntimeOverview,
  type linearIssueQuerySchema,
} from '@dovo/protocol'
import { useLinearIssues, useLinearIssueActions } from '@dovo/studio-core'
import { randomUUID } from 'expo-crypto'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import { Field, SearchField } from '../../ui/controls/field'
import { copyText } from '../../ui/content/clipboard'
import { Text } from '../../ui/content/text'
import { Sheet } from '../../ui/layout/sheet'
import { useTheme } from '../../ui/theme'

export function LinearIssuesSheet({
  sources,
  onClose,
}: {
  sources: RuntimeOverview[]
  onClose: () => void
}) {
  const uiText = useInterfaceText()
  const [id, setId] = useState(sources[0]?.profile.id ?? '')
  const source = sources.find(({ profile }) => profile.id === id)
  return (
    <Sheet title={uiText('Linear issues')} onClose={onClose}>
      {sources.length > 1 && (
        <Choice
          label={uiText('Computer')}
          value={id}
          onChange={setId}
          items={sources.map((source) => ({
            id: source.profile.id,
            name: runtimeComputerName(source),
          }))}
        />
      )}
      {source ? (
        <LinearSources key={id} source={source} />
      ) : (
        <Text>{uiText('Linear is unavailable.')}</Text>
      )}
    </Sheet>
  )
}

function LinearSources({ source }: { source: RuntimeOverview }) {
  const uiText = useInterfaceText()
  const options = linearIssueSources(
    source.snapshot?.linearConnections,
    source.snapshot?.workspace.repositories ?? [],
    source.snapshot?.linearKeySource !== 'none',
  )
  const [id, setId] = useState(options[0]?.id ?? '')
  const selected = options.find((item) => item.id === id)
  return (
    <>
      {(options.length > 1 || !selected) && (
        <Choice
          label={uiText('Linear source')}
          value={selected ? id : ''}
          onChange={setId}
          items={options.map(({ id, name }) => ({ id, name: uiText(name) }))}
        />
      )}
      {selected && <LinearList key={id} source={source} selection={selected.input} />}
    </>
  )
}

function LinearList({
  source,
  selection,
}: {
  source: RuntimeOverview
  selection: Pick<typeof linearIssueQuerySchema.Type, 'connectionId' | 'repositoryId'>
}) {
  const uiText = useInterfaceText()
  const { styles, colors } = useTheme()
  const { readRuntime } = useRuntime()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string>()
  const [notice, setNotice] = useState('')
  const { connectionId, repositoryId } = selection
  const read = useCallback(
    (input: typeof linearIssueQuerySchema.Type) =>
      readRuntime(
        source.profile,
        '/api/scm/linear/issues/read',
        { ...input, connectionId, repositoryId },
        linearIssuesSchema,
      ),
    [readRuntime, source.profile, connectionId, repositoryId],
  )
  const issues = useLinearIssues(read)
  const submit = () => {
    setSelected(undefined)
    void issues.go(search)
  }
  return (
    <View style={{ gap: 10 }}>
      <SearchField
        label={uiText('Search Linear issues')}
        placeholder={uiText('Title or issue ID')}
        value={search}
        maxLength={200}
        onChangeText={setSearch}
        onSubmitEditing={submit}
      />
      <Action label={uiText('Search')} onPress={submit} />
      {!!issues.error && <Text accessibilityRole="alert">{issues.error}</Text>}
      {issues.busy && <Text style={styles.muted}>{uiText('Loading issues…')}</Text>}
      {!issues.busy && !issues.error && !issues.items.length && (
        <Text>{uiText('No issues found.')}</Text>
      )}
      {issues.items.map((issue) => (
        <View
          key={issue.id}
          style={{ borderBottomWidth: 1, borderColor: colors.border, paddingBottom: 6 }}
        >
          <Action
            variant="ghost"
            label={`${issue.identifier} · ${issue.status} · ${issue.title}`}
            onPress={() => setSelected((current) => (current === issue.id ? undefined : issue.id))}
          />
          {selected === issue.id && (
            <View style={{ gap: 6 }}>
              <Text selectable style={styles.text}>
                {issue.description}
              </Text>
              {source.snapshot?.linearIssueActionsSupported && (
                <LinearIssueEditor
                  source={source}
                  selection={selection}
                  issueId={issue.id}
                  onStatus={(status) => issues.updateStatus(issue.id, status)}
                />
              )}
              <Action
                label={uiText('Open in Linear')}
                variant="outline"
                onPress={() =>
                  void Linking.openURL(issue.url).catch(() =>
                    Alert.alert(uiText('Could not open link')),
                  )
                }
              />
              <Action
                label={uiText('Copy issue')}
                variant="outline"
                onPress={() =>
                  void copyText(
                    `${issue.identifier} ${issue.title}\n${issue.url}\n\n${issue.description}`,
                  ).then(
                    () => setNotice(uiText('Issue copied.')),
                    () => setNotice(uiText('Could not copy issue.')),
                  )
                }
              />
            </View>
          )}
        </View>
      ))}
      {issues.next && (
        <Action
          label={uiText('Load more')}
          disabled={issues.busy}
          onPress={() => void issues.more()}
        />
      )}
      {!!notice && <Text accessibilityLiveRegion="polite">{notice}</Text>}
    </View>
  )
}

function LinearIssueEditor({
  source,
  selection,
  issueId,
  onStatus,
}: {
  source: RuntimeOverview
  selection: Pick<typeof linearIssueQuerySchema.Type, 'connectionId' | 'repositoryId'>
  issueId: string
  onStatus: (status: string) => void
}) {
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  const { readRuntime } = useRuntime()
  const actions = useLinearIssueActions(
    readRuntime,
    source.profile,
    issueId,
    selection,
    randomUUID,
    onStatus,
  )
  const disabled = actions.busy || !source.connected
  return (
    <View style={{ gap: 6 }}>
      {!!actions.error && <Text accessibilityRole="alert">{actions.error}</Text>}
      {actions.issue ? (
        <>
          <Choice
            label={uiText('Status')}
            value={actions.stateId}
            items={actions.issue.states.map(({ id, name }) => ({ id, name }))}
            onChange={actions.setStateId}
            disabled={disabled}
          />
          <Action
            label={uiText('Save status')}
            disabled={disabled || actions.stateId === actions.issue.state.id}
            onPress={() => void actions.saveStatus()}
          />
          {actions.issue.comments.map((comment) => (
            <View key={comment.id}>
              <Text style={styles.muted}>{comment.author}</Text>
              <Text selectable>{comment.body}</Text>
            </View>
          ))}
          <Field
            label={uiText('Comment')}
            value={actions.comment}
            onChangeText={actions.setComment}
            editable={!actions.busy}
            maxLength={12000}
            multiline
          />
          <Action
            label={uiText('Post comment')}
            disabled={disabled || !actions.comment.trim()}
            onPress={() => void actions.postComment()}
          />
        </>
      ) : (
        actions.busy && <Text style={styles.muted}>{uiText('Loading issues…')}</Text>
      )}
    </View>
  )
}
