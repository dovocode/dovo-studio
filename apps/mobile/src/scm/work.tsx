import { router } from 'expo-router'
import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { FlatList, Keyboard, Pressable, View } from 'react-native'
import {
  issueLabel,
  matchesWorkItem,
  type ForgeIssue,
  type ForgePipeline,
  type RuntimeProfile,
  type JiraSource,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/provider'
import { projectSourceKey } from '../runtime/collection-sources'
import {
  jiraSourceKey,
  workSources,
  workSourceName,
  workSourceContentIdentity,
  workSourceInput,
  type WorkSource,
} from './work-sources'
import { useNavigation } from '../shell/navigation'
import { issueHref, jiraIssueHref, pipelineHref } from '../shell/source-route'
import { Text } from '../ui/text'
import { colors, styles } from '../ui/theme'
import { Choice } from '../ui/choice'
import { Action } from '../ui/action'
import { Icon } from '../ui/icon'
import { ScreenHeader } from '../ui/screen-header'
import { SearchField } from '../ui/field'
import { Sheet } from '../ui/sheet'
import { JiraProjectForm } from './jira-binding'
import { WorkForm } from './work-form'
import { WorkSignal } from './pipeline-details'
import { useListScroll } from '../ui/use-list-scroll'
import { useWorkCollection, type WorkPage } from './use-work-collection'
import { matchesPipelineCommit } from './work-list'

type Mode = 'issues' | 'pipelines'
export function WorkScreen({
  mode,
  repositoryId,
  onRepositoryChange,
  commitSha,
  pullNumber,
  onBack,
}: {
  mode: Mode
  repositoryId: string
  onRepositoryChange?: (id: string) => void
  commitSha?: string
  pullNumber?: string
  onBack?: () => void
}) {
  const { overviews, activeId } = useRuntime()
  const { focused, workTarget } = useNavigation()
  const [state, setState] = useState('all')
  const [search, setSearch] = useState('')
  const query = useDeferredValue(search)
  const [serverQuery, setServerQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setServerQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])
  const [sort, setSort] = useState('updated')
  const [filters, setFilters] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [sourceBusy, setSourceBusy] = useState(false)
  const [jiraConnection, setJiraConnection] = useState<{
    profile: RuntimeProfile
    source?: JiraSource
  }>()
  const [creating, setCreating] = useState(false)
  const [formSource, setFormSource] = useState<WorkSource>()
  const [message, setMessage] = useState('')
  const { pages, busy, refresh, more } = useWorkCollection(
    mode,
    repositoryId,
    state,
    mode === 'issues' ? serverQuery : '',
  )
  const sources = workSources(overviews, mode)
  const connected = overviews.some((entry) => entry.connected)
  const listOffset = useRef(0)
  useEffect(() => {
    if (mode !== 'issues' || workTarget?.kind !== 'issue' || workTarget.id) return
    if (activeId)
      onRepositoryChange?.(
        workTarget.jiraSourceId
          ? jiraSourceKey(activeId, workTarget.jiraSourceId)
          : projectSourceKey(activeId, workTarget.repositoryId),
      )
    setSearch('')
    listOffset.current = 0
  }, [workTarget, mode, activeId, onRepositoryChange])
  const visible = pages
    .flatMap((page) => page.items.map((row) => ({ page, row })))
    .filter(({ row, page }) => {
      if (mode === 'pipelines' && !matchesPipelineCommit(row, commitSha)) return false
      if (mode === 'issues' && page.searched && serverQuery) return true
      return (
        matchesWorkItem(row, query) ||
        (!!query.trim() &&
          [workSourceName(page.source), page.source.profile.name].some((value) =>
            value.toLowerCase().includes(query.trim().toLowerCase()),
          ))
      )
    })
    .sort((a, b) =>
      sort === 'title'
        ? a.row.title.localeCompare(b.row.title)
        : (b.row.updatedAt ?? '').localeCompare(a.row.updatedAt ?? ''),
    )
  const { retainPosition, ...listScroll } = useListScroll<(typeof visible)[number]>(
    listOffset,
    focused,
  )
  const eligible = pages.filter(
    (page) => page.source.connected && !page.stale && page.options?.issues,
  )
  const formPage =
    formSource &&
    pages.find(
      (page) => workSourceContentIdentity(page.source) === workSourceContentIdentity(formSource),
    )
  const selected = sources.find((source) => source.key === repositoryId)
  const choose = (page: WorkPage, row: ForgeIssue | ForgePipeline) => {
    if (!focused) return
    retainPosition()
    Keyboard.dismiss()
    router.push(
      page.source.kind === 'jira'
        ? jiraIssueHref(page.source.profile.id, page.source.jiraSource.id, row.id, row.url)
        : (mode === 'issues' ? issueHref : pipelineHref)(
            page.source.profile.id,
            page.source.repository.id,
            row.id,
            row.url,
          ),
    )
  }
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={mode === 'issues' ? 'Issues' : pullNumber ? `PR #${pullNumber} runs` : 'PR runs'}
        subtitle={
          mode === 'issues'
            ? `${visible.length} issue${visible.length === 1 ? '' : 's'} · ${selected ? workSourceName(selected) : 'All sources'}${busy && visible.length ? ' · Updating' : ''}`
            : `${selected ? workSourceName(selected) : 'Project'} · Commit ${commitSha?.slice(0, 8) || 'unavailable'}`
        }
        leading={onBack ? <Action secondary label="Back to PR" onPress={onBack} /> : undefined}
        buttons={
          mode === 'issues'
            ? [
                {
                  icon: 'add',
                  label: 'New issue',
                  disabled: !focused || !eligible.length,
                  onPress: () => {
                    setFormSource(eligible.length === 1 ? eligible[0].source : undefined)
                    setCreating(true)
                  },
                },
                {
                  icon: 'filters',
                  label: 'Issue filters',
                  selected: !!repositoryId || state !== 'all' || sort !== 'updated',
                  onPress: () => setFilters(true),
                },
              ]
            : undefined
        }
      />
      <FlatList
        {...listScroll}
        testID="Work list"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingTop: 0, gap: 0, flexGrow: 1 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        windowSize={7}
        scrollEventThrottle={32}
        refreshing={busy}
        onRefresh={connected ? refresh : undefined}
        ListHeaderComponent={
          <View style={{ gap: 6, paddingBottom: 4 }}>
            <SearchField
              label={`Search ${mode}`}
              value={search}
              maxLength={300}
              onChangeText={setSearch}
              placeholder={mode === 'issues' ? 'Search issues…' : 'Search runs…'}
            />
            {mode === 'issues' && (
              <View style={[styles.row, { flexWrap: 'nowrap', justifyContent: 'space-between' }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Choice
                    compact
                    hideLabel
                    label="Issue state"
                    value={state}
                    onChange={setState}
                    items={[
                      { id: 'all', name: 'All states' },
                      ...[
                        ...new Set(
                          pages.flatMap((page) => [
                            ...(page.options?.issueStates ?? []),
                            ...(page.options?.provider === 'jira'
                              ? page.items.flatMap((row) => ('state' in row ? [row.state] : []))
                              : []),
                          ]),
                        ),
                      ].map((id) => ({ id, name: id })),
                    ]}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Manage issue sources and Jira"
                  onPress={() => setSourcesOpen(true)}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                    opacity: pressed ? 0.55 : 1,
                  })}
                >
                  <Text style={[styles.muted, { color: colors.accent }]}>Sources</Text>
                </Pressable>
              </View>
            )}
            {!!query && (
              <Text style={styles.muted}>
                {mode === 'issues' && pages.some((page) => page.options?.issueSearch)
                  ? 'Searching all connected issue sources.'
                  : 'Search loaded results. Load more for earlier work.'}
              </Text>
            )}
            {!!message && (
              <Text accessibilityRole="alert" style={styles.muted}>
                {message}
              </Text>
            )}
          </View>
        }
        data={visible}
        keyExtractor={({ page, row }) => `${page.source.key}:${row.id}`}
        renderItem={({ item: { page, row } }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${row.title}, ${'state' in row ? row.state : row.status}, ${workSourceName(page.source)}, ${page.source.profile.name}`}
            testID={`Work item ${row.id}`}
            onPress={() => choose(page, row)}
            style={({ pressed }) => ({
              gap: 5,
              paddingVertical: 12,
              borderBottomWidth: 0.5,
              borderBottomColor: colors.border,
              opacity: pressed ? 0.55 : 1,
            })}
          >
            <View style={[styles.row, { flexWrap: 'nowrap' }]}>
              <Icon name={mode === 'issues' ? 'tasks' : 'jobs'} size={14} color={colors.muted} />
              <Text numberOfLines={1} style={[styles.muted, { flex: 1, minWidth: 0 }]}>
                {'state' in row ? issueLabel(row.id) : `Run ${row.number ?? row.id}`} ·{' '}
                {workSourceName(page.source)}
              </Text>
              <Text style={[styles.muted, { flexShrink: 0 }]}>
                {row.updatedAt && !Number.isNaN(Date.parse(row.updatedAt))
                  ? new Date(row.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })
                  : ''}
              </Text>
            </View>
            <View style={[styles.row, { flexWrap: 'nowrap' }]}>
              <Text
                numberOfLines={2}
                style={[styles.text, { flex: 1, minWidth: 0, fontWeight: '600' }]}
              >
                {row.title}
              </Text>
              <Icon name="next" size={12} color={colors.muted} />
            </View>
            {'state' in row ? (
              <Text numberOfLines={1} style={styles.muted}>
                {[row.state, ...(row.assigneeNames ?? row.assignees), ...row.labels]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : (
              <WorkSignal status={row.status} />
            )}
            <Text numberOfLines={1} style={[styles.muted, { fontSize: 12 }]}>
              {page.options?.provider === 'jira'
                ? `Jira · ${(page.source.kind === 'jira' ? page.source.jiraSource.project : '') ?? ''} · `
                : ''}
              {page.source.profile.name}
              {!page.source.connected ? ' · Offline · Saved' : page.stale ? ' · Saved' : ''}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          !busy ? (
            <View style={styles.empty}>
              <Icon name={mode === 'issues' ? 'tasks' : 'jobs'} size={28} color={colors.muted} />
              <Text style={[styles.text, { textAlign: 'center', fontWeight: '600' }]}>
                {query
                  ? 'No matching results'
                  : mode === 'issues'
                    ? 'No issues found'
                    : 'No runs found for this commit'}
              </Text>
              <Text style={[styles.muted, { textAlign: 'center' }]}>
                {!connected
                  ? 'Connect to a computer to load work. Saved results stay available offline.'
                  : mode === 'issues'
                    ? 'Try another state or source, or add Jira in Sources.'
                    : pages.some((page) => page.next)
                      ? 'Load earlier runs below to keep looking.'
                      : 'Refresh after CI starts, or check the PR on its server.'}
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          <View style={{ gap: 12, paddingTop: 12 }}>
            {pages
              .filter(
                (page) =>
                  page.error ||
                  page.next ||
                  (mode === 'issues'
                    ? !page.options?.issues && page.options?.issueNotice
                    : page.options?.pipelineNotice),
              )
              .map((page) => (
                <View key={page.source.key} style={{ gap: 8 }}>
                  {!!page.error && (
                    <Text accessibilityRole="alert" style={styles.error}>
                      {workSourceName(page.source)} · {page.source.profile.name}: {page.error}
                    </Text>
                  )}
                  {!!(mode === 'issues'
                    ? !page.options?.issues && page.options?.issueNotice
                    : page.options?.pipelineNotice) && (
                    <Text style={styles.muted}>
                      {workSourceName(page.source)}:{' '}
                      {mode === 'issues' ? page.options?.issueNotice : page.options?.pipelineNotice}
                    </Text>
                  )}
                  {(page.next || page.error) && (
                    <Action
                      secondary
                      label={`${page.error ? 'Retry' : 'Load more'} · ${workSourceName(page.source)}`}
                      disabled={busy || !page.source.connected}
                      onPress={() => void more(page.source.key)}
                    />
                  )}
                </View>
              ))}
          </View>
        }
      />
      {filters && (
        <Sheet title="Issue filters" onClose={() => setFilters(false)}>
          <Choice
            label="Issue source"
            value={repositoryId}
            onChange={(id) => onRepositoryChange?.(id)}
            items={[
              { id: '', name: 'All sources' },
              ...sources.map((source) => ({
                id: source.key,
                name: `${workSourceName(source)} · ${source.profile.name}`,
              })),
            ]}
          />
          <Choice
            label="Sort issues"
            value={sort}
            onChange={setSort}
            items={[
              { id: 'updated', name: 'Recently updated' },
              { id: 'title', name: 'Title' },
            ]}
          />
          <Action
            secondary
            label="Reset filters"
            onPress={() => {
              onRepositoryChange?.('')
              setState('all')
              setSort('updated')
              setSearch('')
            }}
          />
          <Action label="Show issues" onPress={() => setFilters(false)} />
        </Sheet>
      )}
      {sourcesOpen && (
        <Sheet
          title={jiraConnection ? 'Jira source' : 'Issue sources'}
          busy={sourceBusy}
          onClose={() => {
            setSourcesOpen(false)
            setJiraConnection(undefined)
          }}
        >
          {jiraConnection ? (
            <RuntimeScope runtimeId={jiraConnection.profile.id}>
              <JiraProjectForm
                initial={jiraConnection.source}
                onClose={() => {
                  setSourcesOpen(false)
                  setJiraConnection(undefined)
                }}
                onSaved={refresh}
                onBusyChange={setSourceBusy}
              />
            </RuntimeScope>
          ) : (
            <>
              <Text style={styles.muted}>
                Jira issues are independent of Dovo projects. Browse them here, then link a project
                when needed.
              </Text>
              {sources
                .filter((source) => source.kind === 'jira')
                .map((source) => (
                  <View key={source.key} style={{ gap: 4 }}>
                    <Action
                      secondary
                      label={`${workSourceName(source)} · ${source.profile.name}`}
                      disabled={!source.connected}
                      onPress={() =>
                        setJiraConnection({ profile: source.profile, source: source.jiraSource })
                      }
                    />
                    <Text style={styles.muted}>
                      {source.jiraSource.site} · {source.jiraSource.project}
                      {!source.connected ? ' · Offline' : ''}
                    </Text>
                  </View>
                ))}
              <Text style={[styles.text, { fontWeight: '600' }]}>Connect Jira</Text>
              {overviews.map((entry) => (
                <Action
                  key={entry.profile.id}
                  secondary
                  label={`Add Jira · ${entry.profile.name}`}
                  disabled={!entry.connected}
                  onPress={() => setJiraConnection({ profile: entry.profile })}
                />
              ))}
              {!overviews.length && (
                <Text style={styles.muted}>
                  Connect a computer in Settings to use its signed-in Jira account.
                </Text>
              )}
              {!!sources.some((source) => source.kind === 'repository') && (
                <Text style={styles.muted}>
                  Repository issue trackers are included automatically.
                </Text>
              )}
            </>
          )}
        </Sheet>
      )}
      {creating &&
        (!formPage?.options ? (
          <Sheet title="New issue" onClose={() => setCreating(false)}>
            <Text style={styles.muted}>
              Choose the issue tracker. You can link a Dovo project later.
            </Text>
            {eligible.map((page) => (
              <Action
                key={page.source.key}
                secondary
                label={`${workSourceName(page.source)} · ${page.source.profile.name}`}
                onPress={() => setFormSource(page.source)}
              />
            ))}
          </Sheet>
        ) : (
          <RuntimeScope runtimeId={formPage.source.profile.id}>
            <WorkForm
              key={workSourceContentIdentity(formPage.source)}
              kind="create"
              disabled={!focused || !formPage.source.connected || formPage.stale}
              {...workSourceInput(formPage.source)}
              options={formPage.options}
              onClose={() => setCreating(false)}
              onDone={(message, result) => {
                setCreating(false)
                setMessage(message)
                refresh()
                if (result?.id && result.url)
                  router.push(
                    formPage.source.kind === 'jira'
                      ? jiraIssueHref(
                          formPage.source.profile.id,
                          formPage.source.jiraSource.id,
                          result.id,
                          result.url,
                        )
                      : issueHref(
                          formPage.source.profile.id,
                          formPage.source.repository.id,
                          result.id,
                          result.url,
                        ),
                  )
              }}
            />
          </RuntimeScope>
        ))}
    </View>
  )
}
