import { useEffect, useState } from 'react'
import { Effect } from 'effect'
import { Pressable, ScrollView, View } from 'react-native'
import { responses, type ProjectDirectory, type ProjectContentSearch } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import { SearchField } from '../../ui/controls/field'
import { Text } from '../../ui/content/text'
import { MobileFileTypeIcon } from '../../ui/content/file-tree'
import { Icon } from '../../ui/controls/icon'
import { useTheme } from '../../ui/theme'

export function ProjectFileBrowser({
  taskId,
  checkoutId,
  revision,
  onSelect,
}: {
  taskId: string
  checkoutId: string
  revision: number
  onSelect: (path: string, line?: number) => void
}) {
  const { readEffect, connected, connection } = useRuntime()
  const { styles, colors } = useTheme()
  const [directory, setDirectory] = useState('')
  const [mode, setMode] = useState('files')
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<string>()
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{
    identity: string
    directory?: ProjectDirectory
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
    directory,
    cursor,
    mode,
    query,
  ])
  const current = result?.identity === identity ? result : undefined
  useEffect(() => {
    if (!connected || (mode === 'content' && !query)) return
    let active = true
    const controller = new AbortController()
    const timeout = setTimeout(
      () => {
        const run = (): Effect.Effect<
          {
            directory?: ProjectDirectory
            paths?: string[]
            content?: ProjectContentSearch
            truncated?: boolean
          },
          Error
        > => {
          const input = { id: taskId, checkoutId: checkoutId || undefined }
          if (query) {
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
          return readEffect(
            '/api/tasks/files/directory',
            { ...input, directory, cursor },
            responses.projectDirectory,
          ).pipe(Effect.map((directory) => ({ directory })))
        }
        const failed = (error: unknown) => {
          if (active)
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
                if (active) setResult({ identity, ...value })
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
      active = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [
    readEffect,
    connected,
    taskId,
    checkoutId,
    directory,
    cursor,
    mode,
    query,
    revision,
    retry,
    identity,
  ])
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ paddingHorizontal: 12, gap: 6 }}>
        <Choice
          compact
          label="Project search mode"
          value={mode}
          items={[
            { id: 'files', name: 'File names' },
            { id: 'content', name: 'Code contents' },
          ]}
          onChange={setMode}
        />
        <SearchField
          label={mode === 'content' ? 'Search project code' : 'Search files'}
          value={query}
          onChangeText={(value) => {
            setQuery(value.slice(0, 256))
            setCursor(undefined)
          }}
        />
        {mode === 'content' && (
          <Text style={styles.muted}>
            Case-sensitive literal search · up to 200 matching lines.
          </Text>
        )}
        {!query && mode === 'files' && (
          <View style={styles.row}>
            <Action
              secondary
              label="Parent folder"
              disabled={!directory}
              onPress={() => {
                setDirectory(directory.split('/').slice(0, -1).join('/'))
                setCursor(undefined)
              }}
            />
            <Text style={[styles.muted, { flexShrink: 1 }]}>{directory || 'Project root'}</Text>
          </View>
        )}
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 12, gap: 4 }}
      >
        {!connected ? (
          <Text style={styles.muted}>Reconnect to browse files.</Text>
        ) : mode === 'content' && !query ? (
          <Text style={styles.muted}>Enter text to search this checkout’s code.</Text>
        ) : !current ? (
          <Text>{query ? 'Searching…' : 'Loading folder…'}</Text>
        ) : (
          <>
            {current.error && (
              <View>
                <Text accessibilityRole="alert" style={styles.error}>
                  {current.error}
                </Text>
                <Action
                  secondary
                  label="Retry file search"
                  onPress={() => {
                    setCursor(undefined)
                    setRetry((value) => value + 1)
                  }}
                />
              </View>
            )}
            {current.directory?.entries.map((entry) => (
              <Pressable
                key={entry.path}
                accessibilityRole="button"
                accessibilityLabel={
                  entry.kind === 'directory' ? `Open folder ${entry.path}` : entry.path
                }
                onPress={() => {
                  if (entry.kind === 'directory') {
                    setDirectory(entry.path)
                    setCursor(undefined)
                  } else onSelect(entry.path)
                }}
                style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                {entry.kind === 'directory' ? (
                  <Icon name="folder" size={16} color={colors.muted} />
                ) : (
                  <MobileFileTypeIcon path={entry.path} />
                )}
                <Text style={{ flexShrink: 1 }}>{entry.path.split('/').at(-1)}</Text>
              </Pressable>
            ))}
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
                accessibilityLabel={`Open ${match.path} line ${match.line}`}
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
            {(current.truncated || current.content?.truncated || current.directory?.truncated) && (
              <Text style={styles.muted}>
                Some files are omitted. Narrow the search or open a smaller folder.
              </Text>
            )}
            {current.paths && current.truncated === undefined && (
              <Text style={styles.muted}>
                Listing completeness is unknown. Search covers returned files.
              </Text>
            )}
            {!!current.content?.skippedFiles && (
              <Text style={styles.muted}>
                {current.content.skippedFiles}{' '}
                {current.content.skippedFiles === 1 ? 'item' : 'items'} skipped because they changed
                or exceeded read limits.
              </Text>
            )}
            {(current.directory?.entries.length === 0 ||
              current.paths?.length === 0 ||
              current.content?.matches.length === 0) && (
              <Text style={styles.muted}>
                {query
                  ? current.paths
                    ? current.truncated === false
                      ? 'No matching files.'
                      : 'No matching files in this listing.'
                    : 'No matches in the searched files.'
                  : current.directory?.nextCursor || current.directory?.truncated || cursor
                    ? 'No visible entries on this page.'
                    : 'This folder has no visible files.'}
              </Text>
            )}
            {current.directory?.nextCursor && (
              <Action
                secondary
                label="More entries"
                onPress={() => setCursor(current.directory?.nextCursor)}
              />
            )}
            {cursor && current.directory && (
              <Action secondary label="First entries" onPress={() => setCursor(undefined)} />
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}
