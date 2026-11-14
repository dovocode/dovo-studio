import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { runtimeComputerName } from '@dovo/protocol'
import { nativeEffect } from '../../runtime/state/native-effect'
import { Effect } from 'effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { clientScopeKey, RequestScope, runClientEffect } from '@dovo/client-runtime'
import { type ComponentRef, useEffect, useRef } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { directoryPageSchema, type DirectoryPage } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { SettingsAction as Action } from '../../screens/settings-controls'
import {
  SettingsField as Field,
  SettingsSearchField as SearchField,
} from '../../screens/settings-controls'
import { Icon } from '../../ui/controls/icon'
import { IconButton } from '../../ui/controls/icon-button'
import { SettingsChoice as Choice } from '../../screens/settings-controls'
import { useTheme } from '../../ui/theme'
type Props = {
  initialPath: string
  onSelect: (path: string) => void
  onClose: () => void
}
type Location = {
  path: string
  hidden: boolean
  query: string
  offset: number
  delay: number
}
const locationKey = ({ path, hidden, query }: Location) => JSON.stringify([path, hidden, query])
export function DirectoryPicker(props: Props) {
  const { connection } = useRuntime()
  return <DirectoryBrowser key={clientScopeKey(connection)} {...props} />
}
function DirectoryBrowser({ initialPath, onSelect, onClose }: Props) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  const { read, connected, profile, snapshot, readEffect } = useRuntime()
  const requests = useRef(new RequestScope())
  const editingPath = useRef(false)
  const breadcrumbScroll = useRef<ComponentRef<typeof ScrollView>>(null)
  const [location, setLocation] = useApplicationState<Location>({
    path: initialPath,
    hidden: false,
    query: '',
    offset: 0,
    delay: 0,
  })
  const [draft, setDraft] = useApplicationState(initialPath)
  const [data, setData] = useApplicationState<
    | {
        key: string
        page: DirectoryPage
      }
    | undefined
  >(undefined)
  const [busy, setBusy] = useApplicationState(true)
  const [error, setError] = useApplicationState('')
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
      void runClientEffect(
        readEffect('/api/scm/directories/read', input, directoryPageSchema)
          .pipe(
            Effect.flatMap((result) =>
              nativeEffect(() => {
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
              }),
            ),
          )
          .pipe(
            Effect.catch((error: unknown) =>
              nativeEffect(() => {
                if (current()) setError(error instanceof Error ? error.message : String(error))
              }),
            ),
          )
          .pipe(
            Effect.ensuring(
              nativeEffect(() => {
                if (current()) setBusy(false)
              }).pipe(Effect.orDie),
            ),
          ),
      )
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
    change({
      ...location,
      path,
      query: '',
      offset: 0,
      delay: 0,
    })
  }
  return (
    <View
      style={{
        flex: 1,
      }}
    >
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 8,
          gap: 8,
        }}
      >
        <Text numberOfLines={1} style={styles.muted}>
          {runtimeComputerName({ profile, snapshot })}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <IconButton label={uiText('Back to project')} icon="back" onPress={onClose} />
          <View
            style={{
              flex: 1,
              minWidth: 0,
            }}
          >
            <Field
              label={uiText('Folder path')}
              hideLabel
              value={draft}
              placeholder={uiText('Home folder')}
              autoCorrect={false}
              returnKeyType="go"
              onChangeText={(path) => {
                editingPath.current = true
                setDraft(path)
                change({
                  ...location,
                  path,
                  query: '',
                  offset: 0,
                  delay: 300,
                })
              }}
              editable={connected}
              onSubmitEditing={() => navigate(draft)}
            />
          </View>
        </View>
        <View
          style={[
            styles.row,
            {
              flexWrap: 'nowrap',
              gap: 0,
            },
          ]}
        >
          <IconButton
            label={uiText('Home folder')}
            icon="home"
            disabled={!connected}
            onPress={() => navigate(data?.page.home ?? '~')}
          />
          <IconButton
            label={uiText('Parent folder')}
            icon="moveUp"
            disabled={!available || !page?.parent}
            onPress={() => {
              if (page?.parent) navigate(page.parent)
            }}
          />
          <ScrollView
            ref={breadcrumbScroll}
            style={{
              flex: 1,
            }}
            onContentSizeChange={() =>
              breadcrumbScroll.current?.scrollToEnd({
                animated: false,
              })
            }
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              alignItems: 'center',
            }}
          >
            {breadcrumbs.map((crumb, index) => (
              <View
                key={crumb.path}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                {index > 0 && <Icon name="next" size={10} color={colors.muted} />}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={uiText('Open folder {value0}', { value0: crumb.path })}
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
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <View
            style={{
              flex: 1,
              minWidth: 0,
            }}
          >
            <SearchField
              label={uiText('Filter folders')}
              placeholder={uiText('Find a folder')}
              value={location.query}
              editable={connected}
              onChangeText={(query) =>
                change({
                  ...location,
                  query,
                  offset: 0,
                  delay: 300,
                })
              }
            />
          </View>
          <View
            style={{
              width: 112,
            }}
          >
            <Choice
              label={uiText('Folder visibility')}
              hideLabel
              compact
              disabled={!connected}
              value={location.hidden ? 'all' : 'visible'}
              items={[
                {
                  id: 'visible',
                  name: uiText('Visible'),
                },
                {
                  id: 'all',
                  name: uiText('All folders'),
                },
              ]}
              onChange={(value) =>
                change({
                  ...location,
                  hidden: value === 'all',
                  offset: 0,
                  delay: 0,
                })
              }
            />
          </View>
        </View>
      </View>
      <ScrollView
        style={{
          flex: 1,
        }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingVertical: 8,
          gap: 4,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {!connected && (
          <Text accessibilityRole="alert" style={styles.muted}>
            <InterfaceText>{'Reconnect to browse and choose a folder.'}</InterfaceText>
          </Text>
        )}
        {!!error && (
          <View
            style={{
              gap: 4,
            }}
          >
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Action
              label={uiText('Retry folders')}
              secondary
              disabled={!connected || busy}
              onPress={() =>
                change({
                  ...location,
                  delay: 0,
                })
              }
            />
          </View>
        )}
        <Text
          numberOfLines={1}
          accessibilityLiveRegion="polite"
          style={[
            styles.muted,
            {
              paddingVertical: 4,
            },
          ]}
        >
          {!connected
            ? uiText('Offline')
            : error
              ? uiText('Folder unavailable')
              : busy
                ? location.offset
                  ? uiText('Loading more folders…')
                  : uiText('Loading folders…')
                : !page
                  ? '\u00a0'
                  : page.total === undefined
                    ? uiText('{value0} folders loaded', { value0: page.entries.length })
                    : uiText('{value0} of {value1} {value2}', {
                        value0: page.entries.length,
                        value1: page.total,
                        value2: page.total === 1 ? 'folder' : 'folders',
                      })}
        </Text>
        {page && (
          <>
            {page.entries.map((entry) => (
              <Pressable
                key={entry.path}
                accessibilityRole="button"
                accessibilityLabel={uiText('Open {value0} folder', { value0: entry.name })}
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
                <Text
                  numberOfLines={2}
                  style={[
                    styles.text,
                    {
                      flex: 1,
                      minWidth: 0,
                    },
                  ]}
                >
                  {entry.name}
                </Text>
                <Icon name="next" size={12} color={colors.muted} />
              </Pressable>
            ))}
            {!page.entries.length && !busy && !error && (
              <Text
                style={[
                  styles.muted,
                  {
                    paddingVertical: 12,
                  },
                ]}
              >
                {location.query
                  ? uiText('No folders match this filter.')
                  : uiText('No subfolders. You can choose this folder.')}
              </Text>
            )}
            {page.nextOffset !== null && (
              <Action
                label={uiText('Load more folders')}
                secondary
                disabled={!available}
                onPress={() => {
                  if (page.nextOffset !== null)
                    change({
                      ...location,
                      offset: page.nextOffset,
                      delay: 0,
                    })
                }}
              />
            )}
          </>
        )}
      </ScrollView>
      <View style={styles.sheetFooter}>
        <Text numberOfLines={2} selectable style={styles.muted}>
          {page?.path ?? (draft || uiText('Home folder'))}
        </Text>
        <Action
          label={uiText('Choose this folder')}
          disabled={!available}
          onPress={() => {
            if (available && page) onSelect(page.path)
          }}
        />
      </View>
    </View>
  )
}
