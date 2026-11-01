import { useEffect, useRef, useState } from 'react'
import { Effect } from 'effect'
import { Pressable, View } from 'react-native'
import { responses, type ProjectDirectory } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Icon } from '../../ui/controls/icon'
import { MobileFileTypeIcon } from '../../ui/content/file-tree'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

type Props = {
  taskId: string
  checkoutId: string
  revision: number
  refresh?: number
  selected?: string
  active: boolean
  onSelect: (path: string) => void
}

type BranchProps = Props & Pick<ReturnType<typeof useRuntime>, 'readEffect' | 'connected'>

export function ProjectDirectoryTree(props: Props) {
  const { readEffect, connected } = useRuntime()
  return <Directory {...props} readEffect={readEffect} connected={connected} path="" depth={0} />
}

function Directory({ path, depth, ...props }: BranchProps & { path: string; depth: number }) {
  const { readEffect, connected } = props
  const { styles, colors } = useTheme()
  const [result, setResult] = useState<ProjectDirectory>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const version = JSON.stringify([props.revision, props.refresh])
  const [page, setPage] = useState<{ version: string; cursor?: string }>({ version })
  const [retry, setRetry] = useState(0)
  const cursor = page.version === version ? page.cursor : undefined
  const loaded = useRef('')
  const key = JSON.stringify([version, cursor, retry])
  useEffect(() => {
    if (!connected) {
      loaded.current = ''
      return
    }
    if (!props.active || loaded.current === key) return
    let current = true
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void Effect.runPromise(
      readEffect(
        '/api/tasks/files/directory',
        { id: props.taskId, checkoutId: props.checkoutId || undefined, directory: path, cursor },
        responses.projectDirectory,
      ),
      { signal: controller.signal },
    ).then(
      (value) => {
        if (!current) return
        loaded.current = key
        setResult((previous) => ({
          ...value,
          entries: cursor
            ? [
                ...new Map(
                  [...(previous?.entries ?? []), ...value.entries].map((entry) => [
                    entry.path,
                    entry,
                  ]),
                ).values(),
              ]
            : value.entries,
        }))
        setLoading(false)
      },
      (failure: unknown) => {
        if (!current) return
        setError(failure instanceof Error ? failure.message : String(failure))
        setLoading(false)
      },
    )
    return () => {
      current = false
      controller.abort()
    }
  }, [props.active, connected, readEffect, props.taskId, props.checkoutId, path, cursor, key])
  return (
    <View style={{ gap: 2 }}>
      {result?.entries.map((entry) =>
        entry.kind === 'directory' ? (
          <FolderEntry key={entry.path} {...props} path={entry.path} depth={depth} />
        ) : (
          <Pressable
            key={entry.path}
            accessibilityRole="button"
            accessibilityLabel={entry.path}
            accessibilityState={{ selected: props.selected === entry.path }}
            onPress={() => props.onSelect(entry.path)}
            style={{
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingLeft: 24 + Math.min(depth, 8) * 12,
              paddingRight: 8,
              borderRadius: 12,
              backgroundColor: props.selected === entry.path ? colors.selection : 'transparent',
            }}
          >
            <MobileFileTypeIcon path={entry.path} />
            <Text numberOfLines={1} style={{ flex: 1 }}>
              {entry.path.split('/').at(-1)}
            </Text>
          </Pressable>
        ),
      )}
      {!connected && !result && <Text style={styles.muted}>Reconnect to browse files.</Text>}
      {loading && props.active && connected && <Text style={styles.muted}>Loading folder…</Text>}
      {!!error && (
        <View>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Action
            secondary
            label="Retry folder"
            disabled={!connected}
            onPress={() => setRetry((value) => value + 1)}
          />
        </View>
      )}
      {result?.entries.length === 0 && !loading && !error && (
        <Text style={styles.muted}>This folder has no visible files.</Text>
      )}
      {!!result?.nextCursor && (
        <Action
          secondary
          label="More entries"
          disabled={!connected || loading}
          onPress={() => setPage({ version, cursor: result.nextCursor })}
        />
      )}
      {result?.truncated && !result.nextCursor && (
        <Text style={styles.muted}>Some files are omitted. Search to find more files.</Text>
      )}
    </View>
  )
}

function FolderEntry({ path, depth, ...props }: BranchProps & { path: string; depth: number }) {
  const { colors } = useTheme()
  const [expanded, setExpanded] = useState(() => !!props.selected?.startsWith(`${path}/`))
  const [visited, setVisited] = useState(expanded)
  useEffect(() => {
    if (props.selected?.startsWith(`${path}/`)) {
      setExpanded(true)
      setVisited(true)
    }
  }, [props.selected, path])
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Folder ${path}`}
        accessibilityState={{ expanded }}
        onPress={() => {
          setExpanded((value) => !value)
          setVisited(true)
        }}
        style={{
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingLeft: 8 + Math.min(depth, 8) * 12,
          paddingRight: 8,
          borderRadius: 12,
        }}
      >
        <Icon name={expanded ? 'down' : 'next'} size={12} color={colors.muted} />
        <Icon name="folder" size={16} color={colors.muted} />
        <Text numberOfLines={1} style={{ flex: 1 }}>
          {path.split('/').at(-1)}
        </Text>
      </Pressable>
      <View style={expanded ? undefined : { display: 'none' }}>
        {visited && (
          <Directory {...props} path={path} depth={depth + 1} active={props.active && expanded} />
        )}
      </View>
    </View>
  )
}
