import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useState } from 'react'
import { Effect } from 'effect'
import { Pressable, ScrollView, View } from 'react-native'
import { responses, type ProjectContentSearch } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import { SearchField } from '../../ui/controls/field'
import { Text } from '../../ui/content/text'
import { MobileFileTypeIcon } from '../../ui/content/file-tree'
import { ProjectDirectoryTree } from './project-directory-tree'
import { useTheme } from '../../ui/theme'

export function ProjectFileBrowser({
  taskId,
  checkoutId,
  revision,
  selected,
  active = true,
  onSelect,
}: {
  taskId: string
  checkoutId: string
  revision: number
  selected?: string
  active?: boolean
  onSelect: (path: string, line?: number) => void
}) {
  const uiText = useInterfaceText()

  const { readEffect, connected, connection } = useRuntime()
  const { styles, colors } = useTheme()
  const [mode, setMode] = useState('files')
  const [query, setQuery] = useState('')
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{
    identity: string
    paths?: string[]
    content?: ProjectContentSearch
    truncated?: boolean
    error?: string
  }>()
  const identity = JSON.stringify([
    connection?.address,
    connection?.token,
    taskId,
    checkoutId,
    mode,
    query,
  ])
  const current = result?.identity === identity ? result : undefined
  useEffect(() => {
    if (!active || !connected || !query) return
    let currentRequest = true
    const controller = new AbortController()
    const timeout = setTimeout(
      () => {
        const run = (): Effect.Effect<
          {
            paths?: string[]
            content?: ProjectContentSearch
            truncated?: boolean
          },
          Error
        > => {
          const input = { id: taskId, checkoutId: checkoutId || undefined }
          if (mode === 'content')
            return readEffect(
              '/api/tasks/files/search-content',
              { ...input, query },
              responses.projectContentSearch,
            ).pipe(Effect.map((content) => ({ content })))
          return readEffect(
            '/api/tasks/files/search-paths',
            { ...input, query },
            responses.projectFileList,
          ).pipe(Effect.map((paths) => ({ paths: paths.files, truncated: paths.truncated })))
        }
        const failed = (error: unknown) => {
          if (currentRequest)
            setResult((previous) => ({
              ...(previous?.identity === identity ? previous : {}),
              identity,
              error: error instanceof Error ? error.message : String(error),
            }))
        }
        void Effect.runPromise(
          run().pipe(
            Effect.match({
              onSuccess: (value) => {
                if (currentRequest) setResult({ identity, ...value })
              },
              onFailure: failed,
            }),
          ),
          { signal: controller.signal },
        ).catch(failed)
      },
      query ? 200 : 0,
    )
    return () => {
      currentRequest = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [active, readEffect, connected, taskId, checkoutId, mode, query, revision, retry, identity])
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ paddingHorizontal: 12, gap: 6 }}>
        <Choice
          compact
          label={uiText('Project search mode')}
          value={mode}
          items={[
            { id: 'files', name: uiText('File names') },
            { id: 'content', name: uiText('Code contents') },
          ]}
          onChange={setMode}
        />
        <SearchField
          label={mode === 'content' ? uiText('Search project code') : uiText('Search files')}
          value={query}
          onChangeText={(value) => {
            setQuery(value.slice(0, 256))
          }}
        />
        {mode === 'content' && (
          <Text style={styles.muted}>
            <InterfaceText>
              {'Case-sensitive literal search · up to 200 matching lines.'}
            </InterfaceText>
          </Text>
        )}
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 12, gap: 4 }}
      >
        <View style={!query && mode === 'files' ? undefined : { display: 'none' }}>
          <ProjectDirectoryTree
            key={JSON.stringify([connection?.address, connection?.token, taskId, checkoutId])}
            taskId={taskId}
            checkoutId={checkoutId}
            revision={revision}
            active={active && !query && mode === 'files'}
            selected={selected}
            onSelect={onSelect}
          />
        </View>
        {!query && mode === 'files' ? null : !connected ? (
          <Text style={styles.muted}>
            <InterfaceText>{'Reconnect to browse files.'}</InterfaceText>
          </Text>
        ) : mode === 'content' && !query ? (
          <Text style={styles.muted}>
            <InterfaceText>{'Enter text to search this checkout’s code.'}</InterfaceText>
          </Text>
        ) : !current ? (
          <Text>{query ? uiText('Searching…') : uiText('Loading folder…')}</Text>
        ) : (
          <>
            {current.error && (
              <View>
                <Text accessibilityRole="alert" style={styles.error}>
                  {current.error}
                </Text>
                <Action
                  secondary
                  label={uiText('Retry file search')}
                  onPress={() => {
                    setRetry((value) => value + 1)
                  }}
                />
              </View>
            )}
            {current.paths?.map((path) => (
              <Pressable
                key={path}
                accessibilityRole="button"
                accessibilityLabel={path}
                onPress={() => onSelect(path)}
                style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <MobileFileTypeIcon path={path} />
                <Text style={{ flexShrink: 1 }}>{path}</Text>
              </Pressable>
            ))}
            {current.content?.matches.map((match) => (
              <Pressable
                key={`${match.path}:${match.line}`}
                accessibilityRole="button"
                accessibilityLabel={uiText('Open {value0} line {value1}', {
                  value0: match.path,
                  value1: match.line,
                })}
                onPress={() => onSelect(match.path, match.line)}
                style={{ minHeight: 56, paddingVertical: 8 }}
              >
                <Text style={{ fontWeight: '600' }}>
                  {match.path}:{match.line}
                </Text>
                <Text numberOfLines={2} style={{ fontFamily: 'monospace', color: colors.muted }}>
                  {match.excerpt.slice(0, match.matchStart)}
                  <Text style={{ color: colors.text, fontWeight: '700' }}>
                    {match.excerpt.slice(match.matchStart, match.matchEnd)}
                  </Text>
                  {match.excerpt.slice(match.matchEnd)}
                </Text>
              </Pressable>
            ))}
            {(current.truncated || current.content?.truncated) && (
              <Text style={styles.muted}>
                <InterfaceText>
                  {'Some files are omitted. Narrow the search or open a smaller folder.'}
                </InterfaceText>
              </Text>
            )}
            {current.paths && current.truncated === undefined && (
              <Text style={styles.muted}>
                <InterfaceText>
                  {'Listing completeness is unknown. Search covers returned files.'}
                </InterfaceText>
              </Text>
            )}
            {!!current.content?.skippedFiles && (
              <Text style={styles.muted}>
                <InterfaceText
                  values={{
                    value0: current.content.skippedFiles,
                    value1: current.content.skippedFiles === 1 ? uiText('item') : uiText('items'),
                  }}
                >
                  {'{value0} {value1} skipped because they changed or exceeded read limits.'}
                </InterfaceText>
              </Text>
            )}
            {(current.paths?.length === 0 || current.content?.matches.length === 0) && (
              <Text style={styles.muted}>
                {query
                  ? current.paths
                    ? current.truncated === false
                      ? uiText('No matching files.')
                      : uiText('No matching files in this listing.')
                    : uiText('No matches in the searched files.')
                  : uiText('No matching files.')}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}
