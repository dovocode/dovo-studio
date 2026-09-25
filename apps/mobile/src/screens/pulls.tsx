import { nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import {
  comparePulls,
  pullNextStep,
  matchesPull,
  pullNeedsAttention,
  pullState,
  pullChecks,
  pullReview,
  forgeLabels,
} from '@dovo/protocol'
import { Signal, pullSignalColor } from '../scm/pull-status'
import { PullTabs } from '../scm/pull-tabs'
import { Sheet } from '../ui/sheet'
import { useDeferredValue, useMemo, useRef } from 'react'
import { Alert, Keyboard, Linking, FlatList, Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { Text } from '../ui/text'
import { useRuntime } from '../runtime/provider'
import { usePulls } from '../scm/use-pulls'
import { Choice } from '../ui/choice'
import { SearchField } from '../ui/field'
import { Action } from '../ui/action'
import { colors, styles } from '../ui/theme'
import { formatShortDate } from '../ui/format-date'
import { Icon } from '../ui/icon'
import { CreationTarget } from '../runtime/creation-target'
import { collectionSources } from '../runtime/collection-sources'
import { ScreenHeader } from '../ui/screen-header'
import { useListScroll } from '../ui/use-list-scroll'
import { CreatePull } from '../scm/create-pull'
import { useNavigation } from '../shell/navigation'
import { pullHref } from '../shell/source-route'
import { invalidatePullList } from '../scm/pull-list-invalidation'
export default function PullsScreen() {
  const [repositoryId, setRepository] = useApplicationState('')
  return <PullsContent repositoryId={repositoryId} setRepository={setRepository} />
}
function PullsContent({
  repositoryId,
  setRepository,
}: {
  repositoryId: string
  setRepository: (id: string) => void
}) {
  const { overviews, cacheForRuntime } = useRuntime()
  const { focused } = useNavigation()
  const listOffset = useRef(0)
  const [creating, setCreating] = useApplicationState(false)
  const [state, setState] = useApplicationState('open'),
    [search, setSearch] = useApplicationState(''),
    [draft, setDraft] = useApplicationState('all'),
    [filters, setFilters] = useApplicationState(false),
    [attention, setAttention] = useApplicationState(false),
    [sort, setSort] = useApplicationState('attention')
  const { pages, sources, busy, connected, more, refresh } = usePulls(repositoryId, state)
  const openPull = (runtimeId: string, repositoryId: string, number: number) => {
    retainPosition()
    Keyboard.dismiss()
    router.push(pullHref(runtimeId, repositoryId, number))
  }
  const query = useDeferredValue(search)
  const attentionCount = pages.reduce(
    (count, page) => count + page.pulls.filter(pullNeedsAttention).length,
    0,
  )
  const pulls = useMemo(
    () =>
      pages
        .flatMap((page) =>
          page.pulls.map((pull) => ({
            ...pull,
            runtimeId: page.runtimeId,
            runtimeName: page.runtimeName,
            online: page.connected,
            sourceKey: page.sourceKey,
            repositoryId: page.repositoryId,
            repositoryName: page.name,
          })),
        )
        .filter(
          (p) =>
            (state === 'all' || p.state === state) &&
            (draft === 'all' || p.draft === (draft === 'draft')) &&
            (!attention || pullNeedsAttention(p)) &&
            matchesPull(p, p.repositoryName, query),
        )
        .sort((a, b) => comparePulls(a, b, sort === 'attention')),
    [pages, state, draft, attention, query, sort],
  )
  const { retainPosition, ...listScroll } = useListScroll<(typeof pulls)[number]>(
    listOffset,
    focused,
  )
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Pull requests"
        subtitle={`${!connected ? 'Offline · ' : ''}${pulls.length} pull request${pulls.length === 1 ? '' : 's'}${!connected ? ' saved' : busy && pulls.length ? ' · Updating' : ''}`}
        buttons={[
          {
            label: 'Create PR',
            icon: 'add',
            disabled: !connected,
            onPress: () => setCreating(true),
          },
          {
            label: 'PR filters',
            icon: 'filters',
            selected: filters,
            onPress: () => setFilters(true),
          },
        ]}
      />
      {creating && (
        <CreationTarget title="Create pull request" onClose={() => setCreating(false)}>
          {(runtimeId) => (
            <CreatePull
              repositoryId={
                sources.find(
                  (source) => source.key === repositoryId && source.profile.id === runtimeId,
                )?.repository.id ?? ''
              }
              onClose={() => setCreating(false)}
              onCreated={(repositoryId, number) => {
                setCreating(false)
                const owner = overviews.find((entry) => entry.profile.id === runtimeId)
                if (owner) invalidatePullList(cacheForRuntime(owner.profile), repositoryId)
                openPull(runtimeId, repositoryId, number)
              }}
            />
          )}
        </CreationTarget>
      )}
      <FlatList
        {...listScroll}
        testID="Pull requests list"
        contentInsetAdjustmentBehavior="automatic"
        scrollEventThrottle={32}
        refreshing={busy}
        onRefresh={connected ? refresh : undefined}
        keyboardDismissMode="on-drag"
        contentContainerStyle={[
          styles.content,
          {
            gap: 0,
            paddingTop: 0,
            flexGrow: 1,
          },
        ]}
        initialNumToRender={10}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View
            style={{
              gap: 4,
              paddingBottom: 4,
            }}
          >
            <SearchField
              label="Search PRs"
              clearButtonMode="while-editing"
              returnKeyType="search"
              placeholder="Title, repository, branch or author…"
              value={search}
              onChangeText={setSearch}
            />
            <View
              style={[
                styles.row,
                {
                  columnGap: 12,
                  rowGap: 0,
                },
              ]}
            >
              <Text
                style={[
                  styles.muted,
                  {
                    flex: 1,
                  },
                ]}
              >
                All computers
              </Text>
              {attentionCount > 0 && state === 'open' && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={attention ? 'Show all PRs' : 'Show PRs needing attention'}
                  accessibilityState={{
                    selected: attention,
                  }}
                  onPress={() => setAttention((value) => !value)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      flexWrap: 'nowrap',
                      flexShrink: 0,
                      maxWidth: '100%',
                      minHeight: 44,
                      paddingHorizontal: 4,
                      opacity: pressed ? 0.55 : 1,
                    },
                  ]}
                >
                  <Icon name="tasks" size={17} color={colors.accent} />
                  <Text
                    style={[
                      styles.text,
                      {
                        flexShrink: 1,
                        fontSize: 15,
                        color: colors.accent,
                      },
                    ]}
                  >
                    {attentionCount} need{attentionCount === 1 ? 's' : ''} attention
                  </Text>
                  {attention && <Icon name="check" size={14} color={colors.accent} />}
                </Pressable>
              )}
            </View>
            {(repositoryId || draft !== 'all' || attention) && (
              <Text style={styles.muted}>
                {[
                  sources.find((source) => source.key === repositoryId)?.repository.name,
                  draft === 'draft' ? 'Drafts' : draft === 'ready' ? 'Ready for review' : '',
                  attention ? 'Needs attention' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            )}
            <View
              style={{
                marginHorizontal: -16,
              }}
            >
              <PullTabs
                value={state}
                onChange={setState}
                items={[
                  {
                    id: 'open',
                    name: 'Open',
                  },
                  {
                    id: 'merged',
                    name: 'Merged',
                  },
                  {
                    id: 'closed',
                    name: 'Closed',
                  },
                  {
                    id: 'all',
                    name: 'All',
                  },
                ]}
              />
            </View>
          </View>
        }
        data={pulls}
        keyExtractor={(p) => `${p.sourceKey}-${p.number}`}
        renderItem={({ item: p }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${p.runtimeName}${p.online ? '' : ', offline'}, ${p.repositoryName}, PR ${p.number}. ${p.title}. ${pullState(p).label}. ${pullChecks(p).label}. ${pullReview(p).label}. ${p.head} into ${p.base}. ${p.state === 'open' ? pullNextStep(p).label : ''}`}
            onPress={() => openPull(p.runtimeId, p.repositoryId, p.number)}
            onLongPress={() =>
              Alert.alert(p.title, `#${p.number} · ${p.repositoryName}`, [
                {
                  text: 'Open details',
                  onPress: () => openPull(p.runtimeId, p.repositoryId, p.number),
                },
                {
                  text: `Open on ${forgeLabels[p.provider ?? 'github']}`,
                  onPress: () => {
                    void runClientEffect(
                      nativeEffect(() => Linking.openURL(p.url)).pipe(
                        Effect.catchAll((error) =>
                          nativeEffect(() => Alert.alert('Could not open PR', String(error))),
                        ),
                      ),
                    )
                  },
                },
                {
                  text: 'Cancel',
                  style: 'cancel',
                },
              ])
            }
            style={({ pressed }) => ({
              gap: 5,
              paddingVertical: 12,
              borderBottomWidth: 0.5,
              borderBottomColor: colors.border,
              opacity: pressed ? 0.55 : 1,
            })}
          >
            <View
              style={[
                styles.row,
                {
                  flexWrap: 'nowrap',
                },
              ]}
            >
              <Icon name="pulls" size={14} color={pullSignalColor(pullState(p))} />
              <Text
                numberOfLines={1}
                style={[
                  styles.muted,
                  {
                    flex: 1,
                    minWidth: 0,
                  },
                ]}
              >
                {p.repositoryName} · #{p.number} · {p.runtimeName}
                {!p.online ? ' · Offline' : ''}
              </Text>
              <Text style={styles.muted}>{formatShortDate(p.updatedAt)}</Text>
            </View>
            <View
              style={[
                styles.row,
                {
                  flexWrap: 'nowrap',
                },
              ]}
            >
              <Text
                numberOfLines={2}
                style={[
                  styles.text,
                  {
                    flex: 1,
                    minWidth: 0,
                    fontWeight: '600',
                  },
                ]}
              >
                {p.title}
              </Text>
              <Icon name="next" size={12} color={colors.muted} />
            </View>
            <Text numberOfLines={1} style={styles.muted}>
              {p.author} · {p.head} → {p.base}
            </Text>
            <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
              <Signal signal={pullChecks(p)} />
              <Signal signal={pullReview(p)} />
            </View>
            {!!p.labels.length && (
              <Text numberOfLines={2} style={styles.muted}>
                {p.labels.slice(0, 3).join(' · ')}
                {p.labels.length > 3 ? ` · +${p.labels.length - 3} labels` : ''}
              </Text>
            )}
            <Signal signal={p.state === 'open' ? pullNextStep(p) : pullState(p)} />
          </Pressable>
        )}
        ListEmptyComponent={
          !busy ? (
            <View style={styles.empty}>
              <Icon name="pulls" size={30} color={colors.muted} />
              <Text
                style={[
                  styles.text,
                  {
                    textAlign: 'center',
                    fontWeight: '600',
                  },
                ]}
              >
                {connected ? 'No pull requests to show' : 'Connect to a computer'}
              </Text>
              <Text
                style={[
                  styles.muted,
                  {
                    textAlign: 'center',
                  },
                ]}
              >
                {connected
                  ? 'Try another filter or pull down to refresh.'
                  : 'Your saved pull requests will appear here when available.'}
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          <View
            style={{
              gap: 10,
            }}
          >
            {pages.map((page) => (
              <View key={page.sourceKey}>
                {page.error && (
                  <Text style={styles.error}>
                    {page.name} · {page.runtimeName}: {page.error}
                  </Text>
                )}
                {(page.hasMore || page.error) && (
                  <Action
                    secondary
                    label={`${page.error ? 'Retry' : 'Load more'} · ${page.name} · ${page.runtimeName}`}
                    disabled={busy || !page.connected}
                    onPress={() => void more(page.sourceKey)}
                  />
                )}
              </View>
            ))}
          </View>
        }
      />
      {filters && (
        <Sheet title="PR filters" onClose={() => setFilters(false)}>
          <Choice
            label="Repository"
            value={repositoryId}
            onChange={setRepository}
            items={[
              {
                id: '',
                name: 'All repositories',
              },
              ...collectionSources(overviews).map((source) => ({
                id: source.key,
                name: `${source.repository.name} · ${source.profile.name}`,
              })),
            ]}
          />
          <Choice
            label="Draft status"
            value={draft}
            onChange={setDraft}
            items={[
              {
                id: 'all',
                name: 'Draft + ready',
              },
              {
                id: 'draft',
                name: 'Drafts',
              },
              {
                id: 'ready',
                name: 'Ready for review',
              },
            ]}
          />
          <Choice
            label="Attention"
            value={attention ? 'attention' : 'all'}
            onChange={(value) => setAttention(value === 'attention')}
            items={[
              {
                id: 'all',
                name: 'All PRs',
              },
              {
                id: 'attention',
                name: 'Needs attention',
              },
            ]}
          />
          <Text style={styles.muted}>
            Your review requests, blocked PRs, and your approved PRs with passing checks.
          </Text>
          <Choice
            label="Sort PRs"
            value={sort}
            onChange={setSort}
            items={[
              {
                id: 'attention',
                name: 'Attention first',
              },
              {
                id: 'updated',
                name: 'Recently updated',
              },
            ]}
          />
          <Action
            secondary
            label="Reset PR filters"
            onPress={() => {
              setRepository('')
              setDraft('all')
              setAttention(false)
              setSort('attention')
              setSearch('')
              setState('open')
            }}
          />
          <Action label="Show pull requests" onPress={() => setFilters(false)} />
        </Sheet>
      )}
    </View>
  )
}
