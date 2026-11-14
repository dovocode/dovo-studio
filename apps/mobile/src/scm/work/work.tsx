import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  pipelineSignal,
  pipelineStatusSummary,
  hasJiraIssueFilters,
  jiraIssueOrder,
  jiraWorkflowStatuses,
  type JiraIssueFilters,
  runtimeComputerName,
} from '@dovo/protocol'
import {
  createDetailDrafts,
  detailDraftKey,
  useDetailDraft,
} from '../../runtime/state/detail-drafts'
import { useApplicationState } from '../../runtime/state/application-state'
import { router } from 'expo-router'
import { useDeferredValue, useEffect, useMemo, useRef } from 'react'
import { FlatList, Keyboard, Pressable, View } from 'react-native'
import {
  issueLabel,
  matchesWorkItem,
  type ForgeIssue,
  type ForgePipeline,
  type RuntimeProfile,
  type JiraSource,
  type ForgeWorkOptions,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../../runtime/connection/provider'
import { projectSourceKey } from '../../runtime/state/collection-sources'
import {
  jiraSourceKey,
  workSources,
  workSourceName,
  workSourceContentIdentity,
  workSourceInput,
  type WorkSource,
} from './work-sources'
import { useNavigation } from '../../shell/navigation'
import { backToCollection, issueHref, jiraIssueHref, pipelineHref } from '../../shell/source-route'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { formatShortDate } from '../../ui/content/format-date'
import { Choice } from '../../ui/controls/choice'
import { Action } from '../../ui/controls/action'
import { Icon } from '../../ui/controls/icon'
import { ScreenHeader, type HeaderAction } from '../../ui/layout/screen-header'
import { SearchField } from '../../ui/controls/field'
import { Sheet, type SheetHandle } from '../../ui/layout/sheet'
import { JiraProjectForm } from '../connections/jira-binding'
import { WorkForm } from './work-form'
import { WorkSignal } from '../pulls/detail/pipeline-details'
import { useListScroll } from '../../ui/layout/use-list-scroll'
import { useWorkCollection, type WorkPage } from './use-work-collection'
import { matchesPipelineCommit } from './work-list'
import { startsStatusGroup } from './jira-list'
import { JiraBrowseControls } from './jira-browse-controls'
import { JiraChip, JiraQuickViews, JiraFilterFields } from './jira-filters'
type Mode = 'issues' | 'pipelines'
const workPreferences = createDetailDrafts<{
  jiraFilters: JiraIssueFilters
  layout: 'list' | 'status'
  nativeState: string
  jiraState: string
  search: string
  sort: string
}>({ isClean: () => true })
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
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  const { overviews, activeId } = useRuntime()
  const { focused, workTarget } = useNavigation()
  const sources = workSources(overviews, mode)
  const selected = sources.find((source) => source.key === repositoryId)
  const jiraOnly =
    mode === 'issues' &&
    (selected
      ? selected.kind === 'jira'
      : sources.length > 0 && sources.every((source) => source.kind === 'jira'))
  const { draft: preferences, setField } = useDetailDraft(
    workPreferences,
    detailDraftKey(
      null,
      'work-section',
      mode,
      repositoryId,
      sources.map(workSourceContentIdentity).sort(),
    ),
    () => ({
      jiraFilters: {},
      layout: 'list' as const,
      nativeState: 'all',
      jiraState: 'open',
      search: '',
      sort: 'updated',
    }),
  )
  const { jiraFilters, layout, nativeState, jiraState, search, sort } = preferences
  const setJiraFilters = (value: JiraIssueFilters) => setField('jiraFilters', value)
  const setLayout = (value: 'list' | 'status') => setField('layout', value)
  const setNativeState = (value: string) => setField('nativeState', value)
  const setJiraState = (value: string) => setField('jiraState', value)
  const setSearch = (value: string) => setField('search', value)
  const setSort = (value: string) => setField('sort', value)
  const state = jiraOnly ? jiraState : nativeState
  const setState = jiraOnly ? setJiraState : setNativeState
  const query = useDeferredValue(search)
  const [serverQuery, setServerQuery] = useApplicationState('')
  useEffect(() => {
    const timer = setTimeout(() => setServerQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])
  const [filters, setFilters] = useApplicationState(false)
  const [sourcesOpen, setSourcesOpen] = useApplicationState(false)
  const [sourceBusy, setSourceBusy] = useApplicationState(false)
  const [jiraConnection, setJiraConnection] = useApplicationState<
    | {
        profile: RuntimeProfile
        source?: JiraSource
      }
    | undefined
  >(undefined)
  const [creating, setCreating] = useApplicationState(false)
  const [formTarget, setFormTarget] = useApplicationState<
    { source: WorkSource; options: ForgeWorkOptions } | undefined
  >(undefined)
  const sourcePicker = useRef<SheetHandle>(null)
  const pinForm = (page: WorkPage | undefined) =>
    setFormTarget(page?.options ? { source: page.source, options: page.options } : undefined)
  const [message, setMessage] = useApplicationState('')
  const readFilters = useMemo(
    () => ({
      ...jiraFilters,
      orderBy: jiraIssueOrder(layout === 'status' ? 'board' : 'list', sort),
    }),
    [jiraFilters, layout, sort],
  )
  const { pages, busy, refresh, more } = useWorkCollection(
    mode,
    repositoryId,
    mode === 'pipelines' ? 'all' : state,
    mode === 'issues' ? serverQuery : '',
    jiraOnly ? readFilters : undefined,
    mode === 'pipelines' ? commitSha : undefined,
  )
  const connected = sources.some(
    (source) => (!repositoryId || source.key === repositoryId) && source.connected,
  )
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
  const statusOrder =
    jiraOnly && layout === 'status'
      ? jiraWorkflowStatuses(
          pages.flatMap((page) => page.items.filter((row): row is ForgeIssue => 'state' in row)),
        )
      : []
  const matching = pages
    .flatMap((page) =>
      page.items.map((row) => ({
        page,
        row,
      })),
    )
    .filter(({ row, page }) => {
      if (mode === 'pipelines' && !matchesPipelineCommit(row, commitSha)) return false
      if (mode === 'issues' && page.searched && serverQuery) return true
      return (
        matchesWorkItem(row, query) ||
        (!!query.trim() &&
          [workSourceName(page.source), page.source.computerName].some((value) =>
            value.toLowerCase().includes(query.trim().toLowerCase()),
          ))
      )
    })
    .sort((a, b) =>
      jiraOnly &&
      layout === 'status' &&
      'state' in a.row &&
      'state' in b.row &&
      a.row.state !== b.row.state
        ? statusOrder.indexOf(a.row.state) - statusOrder.indexOf(b.row.state)
        : sort === 'title'
          ? a.row.title.localeCompare(b.row.title)
          : jiraOnly
            ? 0
            : (b.row.updatedAt ?? '').localeCompare(a.row.updatedAt ?? ''),
    )
  const visible =
    mode === 'pipelines' && state !== 'all'
      ? matching.filter(
          ({ row }) =>
            'status' in row && pipelineSignal(row.status).label === pipelineSignal(state).label,
        )
      : matching
  const pipelineStatuses = pipelineStatusSummary(
    matching.flatMap(({ row }) => ('status' in row ? [row.status] : [])),
    state,
  )
  const { retainPosition, ...listScroll } = useListScroll<(typeof visible)[number]>(
    listOffset,
    focused,
  )
  const eligible = pages.filter(
    (page) => page.source.connected && !page.stale && page.options?.issues,
  )
  const currentFormSource =
    formTarget &&
    sources.find(
      (source) =>
        workSourceContentIdentity(source) === workSourceContentIdentity(formTarget.source),
    )
  const formPage = formTarget
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
        title={
          mode === 'issues'
            ? uiText('Issues')
            : pullNumber
              ? uiText('PR #{value0} runs', { value0: pullNumber })
              : uiText('PR runs')
        }
        onBack={mode === 'issues' ? () => backToCollection('/') : undefined}
        subtitle={
          mode === 'issues'
            ? uiText('{value0} issue{value1} · {value2}', {
                value0: visible.length,
                value1: visible.length === 1 ? '' : 's',
                value2: selected ? workSourceName(selected) : 'All sources',
              })
            : uiText('{value0} · Commit {value1}', {
                value0: selected ? workSourceName(selected) : 'Project',
                value1: commitSha?.slice(0, 8) || 'unavailable',
              })
        }
        leading={
          onBack ? <Action secondary label={uiText('Back to PR')} onPress={onBack} /> : undefined
        }
        buttons={[
          {
            icon: 'refresh',
            label: uiText('Refresh {value0}', { value0: mode }),
            disabled: busy || !connected || !focused,
            onPress: refresh,
          },
          ...(mode === 'issues'
            ? ([
                {
                  icon: 'add',
                  label: uiText('New issue'),
                  disabled: !focused || !eligible.length,
                  onPress: () => {
                    pinForm(eligible.length === 1 ? eligible[0] : undefined)
                    setCreating(true)
                  },
                },
                {
                  icon: 'filters',
                  label: uiText('Issue filters'),
                  selected:
                    !!repositoryId ||
                    state !== 'all' ||
                    sort !== 'updated' ||
                    (jiraOnly && hasJiraIssueFilters(jiraFilters)),
                  onPress: () => setFilters(true),
                },
              ] satisfies HeaderAction[])
            : []),
        ]}
      />
      <FlatList
        {...listScroll}
        testID="Work list"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: 0,
            gap: 0,
            flexGrow: 1,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        windowSize={7}
        scrollEventThrottle={32}
        refreshing={busy}
        onRefresh={connected ? refresh : undefined}
        ListHeaderComponent={
          <View
            style={{
              gap: 6,
              paddingBottom: 4,
            }}
          >
            <SearchField
              label={uiText('Search {value0}', { value0: mode })}
              value={search}
              maxLength={300}
              onChangeText={setSearch}
              placeholder={mode === 'issues' ? uiText('Search issues…') : uiText('Search runs…')}
            />
            {mode === 'pipelines' && (matching.length > 0 || state !== 'all') && (
              <View style={{ gap: 6 }}>
                <Text style={styles.muted}>
                  <InterfaceText>{'In loaded, searched results'}</InterfaceText>
                </Text>
                <View
                  accessibilityRole="none"
                  accessibilityLabel={uiText('Filter loaded runs by status')}
                  style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}
                >
                  {[
                    { status: 'all', label: uiText('All runs'), count: matching.length },
                    ...pipelineStatuses,
                  ].map(({ status: statusValue, label, count }) => {
                    const selected =
                      statusValue === 'all'
                        ? state === 'all'
                        : state !== 'all' && pipelineSignal(state).label === label
                    return (
                      <Pressable
                        key={label}
                        accessibilityRole="button"
                        accessibilityLabel={`${statusValue === 'all' ? uiText('All runs') : uiText('Filter {value0}', { value0: label })}: ${count}${statusValue === 'all' ? '' : uiText(' runs')}`}
                        accessibilityState={{ selected }}
                        onPress={() => setState(selected ? 'all' : statusValue)}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          minHeight: 44,
                          maxWidth: '100%',
                          flexShrink: 1,
                          paddingHorizontal: 10,
                          borderRadius: 12,
                          backgroundColor: selected ? colors.selection : colors.surface,
                          borderWidth: 1,
                          borderColor: selected ? colors.accent : colors.border,
                          opacity: pressed ? 0.55 : 1,
                        })}
                      >
                        {statusValue === 'all' ? (
                          <Text style={styles.text}>
                            <InterfaceText>{'All runs'}</InterfaceText>
                          </Text>
                        ) : (
                          <WorkSignal status={statusValue} />
                        )}
                        <Text style={[styles.muted, { fontVariant: ['tabular-nums'] }]}>
                          {count}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            )}
            {jiraOnly && (
              <>
                {!!jiraFilters.board && !jiraFilters.sprint && (
                  <Text style={styles.muted}>
                    <InterfaceText>
                      {
                        'Showing project issues. Choose a sprint to filter by the selected board. Saved board columns and filters are available in Jira.'
                      }
                    </InterfaceText>
                  </Text>
                )}
                <JiraQuickViews
                  state={state}
                  filters={jiraFilters}
                  onChange={(next, filters) => {
                    setState(next)
                    setJiraFilters(filters)
                  }}
                />
                <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
                  <JiraChip
                    label={uiText('List')}
                    selected={layout === 'list'}
                    onPress={() => setLayout('list')}
                  />
                  <JiraChip
                    label={uiText('By status')}
                    selected={layout === 'status'}
                    onPress={() => setLayout('status')}
                  />
                  {state !== 'all' && (
                    <JiraChip
                      label={uiText('Status: {value0} ×', { value0: state })}
                      onPress={() => setState('all')}
                    />
                  )}
                  {(
                    [
                      'assignee',
                      'priority',
                      'type',
                      'label',
                      'statusCategory',
                      'board',
                      'sprint',
                      'team',
                      'component',
                      'release',
                    ] as const
                  )
                    .filter(
                      (key) =>
                        jiraFilters[key] && !(key === 'assignee' && jiraFilters[key] === 'all'),
                    )
                    .map((key) => (
                      <JiraChip
                        key={key}
                        label={`${key === 'assignee' ? (jiraFilters[key] === 'mine' ? uiText('Assigned to me') : uiText('Unassigned')) : `${key === 'statusCategory' ? uiText('Category') : key === 'type' ? uiText('Type') : key === 'label' ? uiText('Label') : key === 'priority' ? uiText('Priority') : key === 'board' ? uiText('Board') : key === 'sprint' ? uiText('Sprint') : key === 'team' ? uiText('Team') : key === 'component' ? uiText('Component') : uiText('Release')}: ${jiraFilters[key]}`} ×`}
                        onPress={() =>
                          setJiraFilters({
                            ...jiraFilters,
                            [key]: undefined,
                            ...(key === 'board' ? { sprint: undefined } : {}),
                          })
                        }
                      />
                    ))}
                </View>
              </>
            )}
            {mode === 'issues' && (
              <View
                style={[
                  styles.row,
                  {
                    flexWrap: 'nowrap',
                    justifyContent: 'space-between',
                  },
                ]}
              >
                <View
                  style={{
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {!jiraOnly && (
                    <Choice
                      compact
                      hideLabel
                      label={uiText('Issue state')}
                      value={state}
                      onChange={setState}
                      items={[
                        {
                          id: 'all',
                          name: uiText('All states'),
                        },
                        ...[
                          ...new Set(
                            pages.flatMap((page) => [
                              ...(page.options?.issueStates ?? []),
                              ...(page.options?.provider === 'jira'
                                ? page.items.flatMap((row) => ('state' in row ? [row.state] : []))
                                : []),
                            ]),
                          ),
                        ].map((id) => ({
                          id,
                          name: id,
                        })),
                      ]}
                    />
                  )}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={uiText('Manage issue sources and Jira')}
                  onPress={() => setSourcesOpen(true)}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                    opacity: pressed ? 0.55 : 1,
                  })}
                >
                  <Text
                    style={[
                      styles.muted,
                      {
                        color: colors.accent,
                      },
                    ]}
                  >
                    <InterfaceText>{'Sources'}</InterfaceText>
                  </Text>
                </Pressable>
              </View>
            )}
            <Text
              numberOfLines={1}
              accessibilityLiveRegion="polite"
              style={[styles.muted, { minHeight: 16 }]}
            >
              {busy
                ? `${pages.some((page) => page.items.length) ? uiText('Updating') : uiText('Loading')} ${mode}…`
                : !connected && pages.length
                  ? pages.some((page) => page.items.length)
                    ? uiText('Offline · showing saved results.')
                    : uiText('Connect to load {value0}.', { value0: mode })
                  : query
                    ? mode === 'issues' && pages.some((page) => page.options?.issueSearch)
                      ? uiText('Searching all connected issue sources.')
                      : uiText('Search loaded results. Load more for earlier work.')
                    : '\u00a0'}
            </Text>
            {!!message && (
              <Text accessibilityRole="alert" style={styles.muted}>
                {message}
              </Text>
            )}
          </View>
        }
        data={visible}
        keyExtractor={({ page, row }) => `${page.source.key}:${row.id}`}
        renderItem={({ item: { page, row }, index }) => (
          <View>
            {jiraOnly &&
              layout === 'status' &&
              'state' in row &&
              startsStatusGroup(row, visible[index - 1]?.row) && (
                <Text
                  accessibilityRole="header"
                  style={[styles.text, { fontWeight: '700', paddingTop: 18, paddingBottom: 8 }]}
                >
                  {row.state}
                </Text>
              )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${row.title}, ${'state' in row ? row.state : row.status}, ${workSourceName(page.source)}, ${page.source.computerName}`}
              testID={`Work item ${row.id}`}
              onPress={() => choose(page, row)}
              style={({ pressed }) => ({
                gap: 5,
                paddingVertical: 12,
                paddingHorizontal: 10,
                marginVertical: 3,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: 'transparent',
                backgroundColor: pressed ? colors.selection : 'transparent',
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
                {'status' in row ? (
                  <WorkSignal status={row.status} emphasis />
                ) : (
                  <Icon name="tasks" size={14} color={colors.muted} />
                )}
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
                  {'state' in row
                    ? issueLabel(row.id)
                    : uiText('Run {value0}', { value0: row.number ?? row.id })}{' '}
                  · {workSourceName(page.source)}
                </Text>
                <Text
                  style={[
                    styles.muted,
                    {
                      flexShrink: 0,
                    },
                  ]}
                >
                  {row.updatedAt && !Number.isNaN(Date.parse(row.updatedAt))
                    ? formatShortDate(row.updatedAt)
                    : ''}
                </Text>
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
                  {row.title}
                </Text>
                <Icon name="next" size={12} color={colors.muted} />
              </View>
              {'state' in row ? (
                <View style={{ gap: 4 }}>
                  <Text style={styles.muted}>
                    {row.state} · {row.type}
                    {row.priority ? uiText(' · {value0} priority', { value0: row.priority }) : ''}
                  </Text>
                  <Text numberOfLines={2} style={styles.text}>
                    {(row.assigneeNames ?? row.assignees).length
                      ? uiText('Assigned to {value0}', {
                          value0: (row.assigneeNames ?? row.assignees).join(', '),
                        })
                      : uiText('Unassigned')}
                  </Text>
                  {!!row.labels.length && (
                    <Text numberOfLines={2} style={styles.muted}>
                      {row.labels.slice(0, 3).join(' · ')}
                      {row.labels.length > 3
                        ? uiText(' · +{value0} labels', { value0: row.labels.length - 3 })
                        : ''}
                    </Text>
                  )}
                </View>
              ) : (
                <Text numberOfLines={1} style={styles.muted}>
                  {[row.ref, row.sha?.slice(0, 8), row.actor].filter(Boolean).join(' · ')}
                </Text>
              )}
              <Text
                numberOfLines={1}
                style={[
                  styles.muted,
                  {
                    fontSize: 12,
                  },
                ]}
              >
                {page.options?.provider === 'jira'
                  ? uiText('Jira · {value0} · ', {
                      value0:
                        (page.source.kind === 'jira' ? page.source.jiraSource.project : '') ?? '',
                    })
                  : ''}
                {page.source.computerName}
                {!page.source.connected
                  ? uiText(' · Offline · Saved')
                  : page.stale
                    ? uiText(' · Saved')
                    : ''}
              </Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          !busy ? (
            <View style={styles.empty}>
              <Icon name={mode === 'issues' ? 'tasks' : 'jobs'} size={28} color={colors.muted} />
              <Text
                style={[
                  styles.text,
                  {
                    textAlign: 'center',
                    fontWeight: '600',
                  },
                ]}
              >
                {query || (mode === 'pipelines' && state !== 'all')
                  ? uiText('No matching results')
                  : mode === 'issues'
                    ? uiText('No issues found')
                    : uiText('No runs found for this commit')}
              </Text>
              <Text
                style={[
                  styles.muted,
                  {
                    textAlign: 'center',
                  },
                ]}
              >
                {!connected
                  ? uiText(
                      'Connect to a computer to load work. Saved results stay available offline.',
                    )
                  : mode === 'pipelines' && state !== 'all'
                    ? uiText('Choose All runs or another status above.')
                    : mode === 'issues'
                      ? uiText('Try another state or source, or add Jira in Sources.')
                      : pages.some((page) => page.next)
                        ? uiText('Load earlier runs below to keep looking.')
                        : uiText('Refresh after CI starts, or check the PR on its server.')}
              </Text>
            </View>
          ) : undefined
        }
        ListFooterComponent={
          <View
            style={{
              gap: 12,
              paddingTop: 12,
            }}
          >
            {pages
              .filter(
                (page) =>
                  page.error ||
                  page.optionsError ||
                  page.next ||
                  (mode === 'issues'
                    ? !page.options?.issues && page.options?.issueNotice
                    : page.options?.pipelineNotice),
              )
              .map((page) => (
                <View
                  key={page.source.key}
                  style={{
                    gap: 8,
                  }}
                >
                  {!!(page.error || page.optionsError) && (
                    <Text accessibilityRole="alert" style={styles.error}>
                      {workSourceName(page.source)} · {page.source.computerName}:{' '}
                      {page.error || page.optionsError}
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
                  {(page.next || page.error || page.optionsError) && (
                    <Action
                      secondary
                      label={`${page.error || page.optionsError ? uiText('Retry') : uiText('Load more')} · ${workSourceName(page.source)}`}
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
        <Sheet title={uiText('Issue filters')} onClose={() => setFilters(false)}>
          <Choice
            label={uiText('Issue source')}
            value={repositoryId}
            onChange={(id) => onRepositoryChange?.(id)}
            items={[
              {
                id: '',
                name: uiText('All sources'),
              },
              ...sources.map((source) => ({
                id: source.key,
                name: `${workSourceName(source)} · ${source.computerName}`,
              })),
            ]}
          />
          {jiraOnly && (
            <>
              <JiraBrowseControls
                source={selected ?? (sources.length === 1 ? sources[0] : undefined)}
                filters={jiraFilters}
                onFilters={setJiraFilters}
                enabled={focused}
              />
              <JiraFilterFields
                state={state}
                filters={jiraFilters}
                issues={pages.flatMap((page) =>
                  page.items.filter((row): row is ForgeIssue => 'state' in row),
                )}
                onState={setState}
                onFilters={setJiraFilters}
              />
            </>
          )}
          <Choice
            label={uiText('Sort issues')}
            value={sort}
            onChange={setSort}
            items={[
              {
                id: 'updated',
                name: jiraOnly
                  ? `Default · ${layout === 'status' ? 'Jira rank' : 'recently updated'}`
                  : 'Recently updated',
              },
              ...(jiraOnly
                ? [
                    { id: 'rank', name: uiText('Jira rank · per source') },
                    { id: 'recent', name: uiText('Recently updated · per source') },
                  ]
                : []),
              {
                id: 'title',
                name: uiText('Title'),
              },
            ]}
          />
          <Action
            secondary
            label={uiText('Reset filters')}
            onPress={() => {
              onRepositoryChange?.('')
              setState('all')
              setJiraFilters({})
              setLayout('list')
              setSort('updated')
              setSearch('')
            }}
          />
          <Action label={uiText('Show issues')} onPress={() => setFilters(false)} />
        </Sheet>
      )}
      {sourcesOpen && (
        <Sheet
          title={jiraConnection ? uiText('Jira source') : uiText('Issue sources')}
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
                <InterfaceText>
                  {
                    'Jira issues are independent of Dovo projects. Browse them here, then link a project when needed.'
                  }
                </InterfaceText>
              </Text>
              {sources
                .filter((source) => source.kind === 'jira')
                .map((source) => (
                  <View
                    key={source.key}
                    style={{
                      gap: 4,
                    }}
                  >
                    <Action
                      secondary
                      label={`${workSourceName(source)} · ${source.computerName}`}
                      disabled={!source.connected}
                      onPress={() =>
                        setJiraConnection({
                          profile: source.profile,
                          source: source.jiraSource,
                        })
                      }
                    />
                    <Text style={styles.muted}>
                      {source.jiraSource.site} · {source.jiraSource.project}
                      {!source.connected ? uiText(' · Offline') : ''}
                    </Text>
                  </View>
                ))}
              <Text
                style={[
                  styles.text,
                  {
                    fontWeight: '600',
                  },
                ]}
              >
                <InterfaceText>{'Connect Jira'}</InterfaceText>
              </Text>
              {overviews.map((entry) => (
                <Action
                  key={entry.profile.id}
                  secondary
                  label={uiText('Add Jira · {value0}', { value0: runtimeComputerName(entry) })}
                  disabled={!entry.connected}
                  onPress={() =>
                    setJiraConnection({
                      profile: entry.profile,
                    })
                  }
                />
              ))}
              {!overviews.length && (
                <Text style={styles.muted}>
                  <InterfaceText>
                    {'Connect a computer in Settings to use its signed-in Jira account.'}
                  </InterfaceText>
                </Text>
              )}
              {!!sources.some((source) => source.kind === 'repository') && (
                <Text style={styles.muted}>
                  <InterfaceText>
                    {'Repository issue trackers are included automatically.'}
                  </InterfaceText>
                </Text>
              )}
            </>
          )}
        </Sheet>
      )}
      {creating &&
        (!formPage?.options ? (
          <Sheet ref={sourcePicker} title={uiText('New issue')} onClose={() => setCreating(false)}>
            <Text style={styles.muted}>
              <InterfaceText>
                {'Choose the issue tracker. You can link a Dovo project later.'}
              </InterfaceText>
            </Text>
            {eligible.map((page) => (
              <Action
                key={page.source.key}
                secondary
                label={`${workSourceName(page.source)} · ${page.source.computerName}`}
                onPress={() =>
                  sourcePicker.current?.dismiss(() => {
                    pinForm(page)
                    setCreating(true)
                  })
                }
              />
            ))}
          </Sheet>
        ) : (
          <RuntimeScope runtimeId={formPage.source.profile.id}>
            <WorkForm
              key={workSourceContentIdentity(formPage.source)}
              kind="create"
              disabled={!focused || !currentFormSource?.connected}
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
