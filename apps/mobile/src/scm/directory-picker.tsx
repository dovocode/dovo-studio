import { clientScopeKey, RequestScope } from '@dovo/client-runtime'
import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { directoryPageSchema, type DirectoryPage } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Field, SearchField } from '../ui/field'
import { Icon } from '../ui/icon'
import { IconButton } from '../ui/icon-button'
import { Choice } from '../ui/choice'
import { colors, styles } from '../ui/theme'

type Props = {
  initialPath: string
  onSelect: (path: string) => void
  onClose: () => void
}
type Location = { path: string; hidden: boolean; query: string; offset: number; delay: number }
const locationKey = ({ path, hidden, query }: Location) => JSON.stringify([path, hidden, query])

export function DirectoryPicker(props: Props) {
  const { connection } = useRuntime()
  return <DirectoryBrowser key={clientScopeKey(connection)} {...props} />
}
function DirectoryBrowser({ initialPath, onSelect, onClose }: Props) {
  const { read, connected, profile, snapshot } = useRuntime()
  const requests = useRef(new RequestScope())
  const editingPath = useRef(false)
  const breadcrumbScroll = useRef<ScrollView>(null)
  const [location, setLocation] = useState<Location>({
    path: initialPath,
    hidden: false,
    query: '',
    offset: 0,
    delay: 0,
  })
  const [draft, setDraft] = useState(initialPath)
  const [data, setData] = useState<{ key: string; page: DirectoryPage }>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const key = locationKey(location)
  const page = data?.key === key ? data.page : undefined
  const breadcrumbs = page?.breadcrumbs ?? []
  const available = connected && !busy && !error && !!page
  useEffect(() => {
    const current = requests.current.begin()
    if (!connected) {
      setBusy(false)
      return () => requests.current.cancel()
    }
    setBusy(true)
    setError('')
    const timer = setTimeout(() => {
      const { delay: _delay, ...input } = location
      void read('/api/scm/directories/read', input, directoryPageSchema)
        .then((result) => {
          if (!current()) return
          setData((previous) => ({
            key,
            page: {
              ...result,
              entries:
                input.offset && previous?.key === key
                  ? [
                      ...new Map(
                        [...previous.page.entries, ...result.entries].map((entry) => [
                          entry.path,
                          entry,
                        ]),
                      ).values(),
                    ]
                  : result.entries,
            },
          }))
          if (!editingPath.current) setDraft(result.path)
        })
        .catch((error: unknown) => {
          if (current()) setError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (current()) setBusy(false)
        })
    }, location.delay)
    return () => {
      requests.current.cancel()
      clearTimeout(timer)
    }
  }, [location, key, read, connected])
  const change = (next: Location) => {
    // Invalidate immediately: a response arriving before the next effect must not replace typed text.
    requests.current.cancel()
    setBusy(true)
    setError('')
    setLocation(next)
  }
  const navigate = (path: string) => {
    editingPath.current = false
    setDraft(path)
    change({ ...location, path, query: '', offset: 0, delay: 0 })
  }
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 8 }}>
        <Text numberOfLines={1} style={styles.muted}>
          {profile?.name ?? snapshot?.runtimeHost ?? 'Connected computer'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <IconButton label="Back to project" icon="back" onPress={onClose} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Field
              label="Folder path"
              hideLabel
              value={draft}
              placeholder="Home folder"
              autoCorrect={false}
              returnKeyType="go"
              onChangeText={(path) => {
                editingPath.current = true
                setDraft(path)
                change({ ...location, path, query: '', offset: 0, delay: 300 })
              }}
              editable={connected}
              onSubmitEditing={() => navigate(draft)}
            />
          </View>
        </View>
        <View style={[styles.row, { flexWrap: 'nowrap', gap: 0 }]}>
          <IconButton
            label="Home folder"
            icon="home"
            disabled={!connected}
            onPress={() => navigate(data?.page.home ?? '~')}
          />
          <IconButton
            label="Parent folder"
            icon="moveUp"
            disabled={!available || !page?.parent}
            onPress={() => {
              if (page?.parent) navigate(page.parent)
            }}
          />
          <ScrollView
            ref={breadcrumbScroll}
            style={{ flex: 1 }}
            onContentSizeChange={() => breadcrumbScroll.current?.scrollToEnd({ animated: false })}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ alignItems: 'center' }}
          >
            {breadcrumbs.map((crumb, index) => (
              <View key={crumb.path} style={{ flexDirection: 'row', alignItems: 'center' }}>
                {index > 0 && <Icon name="next" size={10} color={colors.muted} />}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open folder ${crumb.path}`}
                  disabled={!available}
                  onPress={() => navigate(crumb.path)}
                  style={{
                    minHeight: 44,
                    minWidth: 44,
                    justifyContent: 'center',
                    paddingHorizontal: 8,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.muted,
                      {
                        maxWidth: 160,
                        color: index === breadcrumbs.length - 1 ? colors.text : colors.muted,
                      },
                    ]}
                  >
                    {crumb.name}
                  </Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <SearchField
              label="Filter folders"
              placeholder="Find a folder"
              value={location.query}
              editable={connected}
              onChangeText={(query) => change({ ...location, query, offset: 0, delay: 300 })}
            />
          </View>
          <View style={{ width: 112 }}>
            <Choice
              label="Folder visibility"
              hideLabel
              compact
              disabled={!connected}
              value={location.hidden ? 'all' : 'visible'}
              items={[
                { id: 'visible', name: 'Visible' },
                { id: 'all', name: 'All folders' },
              ]}
              onChange={(value) =>
                change({ ...location, hidden: value === 'all', offset: 0, delay: 0 })
              }
            />
          </View>
        </View>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 4 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {!connected && (
          <Text accessibilityRole="alert" style={styles.muted}>
            Reconnect to browse and choose a folder.
          </Text>
        )}
        {!!error && (
          <View style={{ gap: 4 }}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Action
              label="Retry folders"
              secondary
              disabled={!connected || busy}
              onPress={() => change({ ...location, delay: 0 })}
            />
          </View>
        )}
        {busy && (
          <Text style={styles.muted}>
            {location.offset ? 'Loading more folders…' : 'Loading folders…'}
          </Text>
        )}
        {page && (
          <>
            <Text style={[styles.muted, { paddingVertical: 4 }]}>
              {page.total === undefined
                ? `${page.entries.length} folders loaded`
                : `${page.entries.length} of ${page.total} ${page.total === 1 ? 'folder' : 'folders'}`}
            </Text>
            {page.entries.map((entry) => (
              <Pressable
                key={entry.path}
                accessibilityRole="button"
                accessibilityLabel={`Open ${entry.name} folder`}
                disabled={!available}
                onPress={() => navigate(entry.path)}
                style={({ pressed }) => ({
                  minHeight: 52,
                  paddingVertical: 12,
                  paddingHorizontal: 4,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  borderBottomWidth: 0.5,
                  borderBottomColor: colors.border,
                  backgroundColor: pressed ? colors.surface : 'transparent',
                  opacity: available ? 1 : 0.5,
                })}
              >
                <Icon name="folder" size={20} color={colors.accent} />
                <Text numberOfLines={2} style={[styles.text, { flex: 1, minWidth: 0 }]}>
                  {entry.name}
                </Text>
                <Icon name="next" size={12} color={colors.muted} />
              </Pressable>
            ))}
            {!page.entries.length && !busy && !error && (
              <Text style={[styles.muted, { paddingVertical: 12 }]}>
                {location.query
                  ? 'No folders match this filter.'
                  : 'No subfolders. You can choose this folder.'}
              </Text>
            )}
            {page.nextOffset !== null && (
              <Action
                label="Load more folders"
                secondary
                disabled={!available}
                onPress={() => {
                  if (page.nextOffset !== null)
                    change({ ...location, offset: page.nextOffset, delay: 0 })
                }}
              />
            )}
          </>
        )}
      </ScrollView>
      <View style={styles.sheetFooter}>
        <Text numberOfLines={2} selectable style={styles.muted}>
          {page?.path ?? (draft || 'Home folder')}
        </Text>
        <Action
          label="Choose this folder"
          disabled={!available}
          onPress={() => {
            if (available && page) onSelect(page.path)
          }}
        />
      </View>
    </View>
  )
}
