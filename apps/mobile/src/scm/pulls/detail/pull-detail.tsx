import { PullRequestIcon } from '../../../ui/content/pull-request-icon'
import {
  gitRemoteIdentity,
  forgePullTarget,
  forgeConnectionsSchema,
  type ForgeConnection,
  runtimeComputerName,
} from '@dovo/protocol'
import { CreatePull } from '../list/create-pull'
import { pullHeadBranch, pullStackLabel } from '@dovo/protocol'
import { pullHref } from '../../../shell/source-route'
import { useLinkOrigin } from '../../../ui/content/link-origin'
import { openAppLink } from '../../../ui/content/open-link'
import { formatTime } from '../../../runtime/preferences/app-preferences'
import { nativeEffect } from '../../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../../../runtime/state/application-state'
import { usePullDetail } from './use-pull-detail'
import { Markdown } from '../../../ui/content/markdown'
import { router } from 'expo-router'
import { pipelineRunsHref } from '../../../shell/source-route'
import { useEffect, useRef } from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { Text } from '../../../ui/content/text'
import {
  pullState,
  pullDetailChecks,
  pullDetailReviews,
  pullMergeability,
  forgeLabels,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { Choice } from '../../../ui/controls/choice'
import { Action } from '../../../ui/controls/action'
import { useTheme } from '../../../ui/theme'
import { Icon } from '../../../ui/controls/icon'
import { PullComments } from './pull-comments'
import { PullChanges } from './pull-changes'
import { usePullTaskCreation } from '../list/start-pull-task'
import { PullTabs } from './pull-tabs'
import { PullStatus, Signal } from './pull-status'
import { ScreenHeader } from '../../../ui/layout/screen-header'
import { PullMenu } from '../list/pull-menu'
import { PullPrimaryAction, PullActionSheet, type PullActionTarget } from '../list/pull-actions'
import { pullActionOptions } from '../list/pull-action-options'
import { LineComment } from './line-comment'
import { formatDateTime } from '../../../ui/content/format-date'
import { invalidatePullList } from '../list/pull-list-invalidation'
import { useSheetNavigation } from '../../../ui/layout/sheet'
import {
  createDetailDrafts,
  integrationDraftKey,
  useDetailDraft,
} from '../../../runtime/state/detail-drafts'
import { pullDestination, type PullTab } from './pull-destination'
const pullNavigation = createDetailDrafts<{ tab: PullTab; metadataOpen: boolean }>()
export function PullDetail({
  repositoryId,
  number,
  connectionId,
  onBack,
  initialTab,
  initialFragment = '',
  initialNavigationUrl,
  backLabel = 'Back to PRs',
  embedded = false,
}: {
  repositoryId: string
  number: number
  connectionId?: string
  onBack: () => void
  initialTab?: 'overview' | 'changes' | 'checks'
  initialFragment?: string
  initialNavigationUrl?: string
  backLabel?: string
  embedded?: boolean
}) {
  const { colors, styles } = useTheme()

  const { connected, snapshot, profile, readCache, connection, readEffect } = useRuntime()
  const origin = useLinkOrigin(undefined, repositoryId)
  const repository = snapshot?.workspace.repositories.find((repo) => repo.id === repositoryId)
  const [account, setAccount] = useApplicationState(connectionId)
  const [accounts, setAccounts] = useApplicationState<ForgeConnection[]>([])
  const urlTarget = forgePullTarget(repositoryId)
  useEffect(() => {
    if (!urlTarget || !connected) return
    let active = true
    void runClientEffect(
      readEffect('/api/scm/connections/read', {}, forgeConnectionsSchema).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            if (active)
              setAccounts(
                value.connections.filter(
                  (connection) =>
                    connection.provider === urlTarget.provider &&
                    new URL(connection.baseUrl).host === new URL(urlTarget.url).host,
                ),
              )
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            if (active) setError(error.message)
          }),
        ),
      ),
    )
    return () => {
      active = false
    }
  }, [readEffect, repositoryId, connected])
  const body = useRef<ScrollView>(null)
  const content = useRef<View>(null)
  const navigateAfterSheet = useSheetNavigation()
  const { detail, error, setError, busy, refreshing, refresh, invalidate, acceptCurrentAccount } =
    usePullDetail(repositoryId, number, account)
  const onPosted = () => {
    invalidate()
    invalidatePullList(readCache, repositoryId)
  }
  const taskCreation = usePullTaskCreation(repositoryId, detail?.pull)
  const actionOrigin = useRef(detail)
  const lineOrigin = useRef(detail)
  const stackOrigin = useRef(detail)
  const [creatingStack, setCreatingStack] = useApplicationState(false)
  const { draft: navigation, setField } = useDetailDraft(
    pullNavigation,
    integrationDraftKey(
      connection,
      snapshot,
      repositoryId,
      undefined,
      'pull-navigation',
      number,
      account,
    ),
    () => ({ tab: initialTab ?? 'overview', metadataOpen: false }),
  )
  const { tab, metadataOpen } = navigation
  const setTab = (value: string) => {
    if (value === 'overview' || value === 'changes' || value === 'discussion' || value === 'checks')
      setField('tab', value)
  }
  const setMetadataOpen = (value: boolean) => setField('metadataOpen', value)
  const [fragment, setFragment] = useApplicationState(initialFragment)
  const [changesOpened, setChangesOpened] = useApplicationState(
    initialTab === 'changes' || tab === 'changes',
  )
  const anchored = useRef(false)
  useEffect(() => {
    if (initialTab) setTab(initialTab)
    setFragment(initialFragment)
    anchored.current = false
  }, [initialTab, initialFragment])
  const destination = detail ? pullDestination(detail, tab, fragment) : undefined
  useEffect(() => {
    if (destination && destination.tab !== tab) setTab(destination.tab)
    if (destination?.tab === 'changes') setChangesOpened(true)
  }, [destination?.tab, tab])
  const scrollToAnchor = (node: View) => {
    if (!content.current || anchored.current) return
    node.measureLayout(content.current, (_x, y) => {
      if (anchored.current) return
      anchored.current = true
      body.current?.scrollTo({ y, animated: false })
    })
  }
  const [action, setAction] = useApplicationState<PullActionTarget | null>(null)
  const [lineComment, setLineComment] = useApplicationState<string | null>(null)
  const open = (url: string, external = false) => {
    const bindings = [
      {
        provider: detail?.pull.provider,
        identity: gitRemoteIdentity(detail?.pull.repositoryUrl ?? ''),
      },
    ]
    const target = forgePullTarget(url, bindings)
    if (
      !external &&
      target &&
      detail &&
      forgePullTarget(detail.pull.url, bindings)?.url === target.url
    ) {
      anchored.current = false
      setFragment(target.fragment)
      setTab(target.tab)
      if (target.tab === 'changes') setChangesOpened(true)
      return
    }
    navigateAfterSheet(() => {
      void runClientEffect(
        nativeEffect(() => openAppLink(url, external, origin)).pipe(
          Effect.catch((error) => nativeEffect(() => setError(String(error)))),
        ),
      )
    })
  }
  const discussion = detail?.comments.filter((comment) => comment.kind !== 'inline') ?? []
  const fileBaseURL =
    detail?.fileBaseUrl ??
    (detail && (!detail.pull.provider || detail.pull.provider === 'github')
      ? `${detail.pull.repositoryUrl.replace(/\/$/, '')}/blob/${detail.pull.headSha}/`
      : undefined)
  const actionDisabled = !connected || !!detail?.stale || !!detail?.refreshError
  const actions = detail ? pullActionOptions(detail) : undefined
  const openAction = (target: PullActionTarget) => {
    if (!actionDisabled && detail) {
      actionOrigin.current = detail
      setAction(target)
    }
  }
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={
          embedded
            ? `PR #${number}`
            : detail
              ? `#${number} · ${detail.pull.title}`
              : `PR #${number}`
        }
        subtitle={[
          repository?.name ?? detail?.pull.repositoryUrl.split('/').slice(-2).join('/'),
          runtimeComputerName({ profile, snapshot }),
        ]
          .filter(Boolean)
          .join(' · ')}
        leading={<Action secondary label={backLabel} onPress={onBack} />}
        actions={
          detail ? (
            <PullMenu
              providerName={forgeLabels[detail.pull.provider ?? 'github']}
              onRefresh={refresh}
              onOpen={() =>
                open(
                  initialNavigationUrl ??
                    (fragment ? `${detail.pull.url}${fragment}` : detail.pull.url),
                  true,
                )
              }
              onStartTask={taskCreation.start}
              prBranchAvailable={!!detail.pull.headCloneUrl}
              refreshDisabled={!connected || refreshing}
              taskDisabled={!repository || !connected || taskCreation.busy}
              actions={actions?.secondary ?? []}
              onAction={openAction}
              actionDisabled={actionDisabled}
            />
          ) : (
            <Action
              secondary
              label="Refresh details"
              disabled={!connected || busy}
              onPress={refresh}
            />
          )
        }
      />
      {urlTarget && !!accounts.length && (
        <Choice
          label="Source account"
          value={account ?? detail?.pull.connectionId ?? ''}
          onChange={setAccount}
          items={accounts.map((account) => ({ id: account.id, name: account.name }))}
        />
      )}
      {/different account/.test(error) && (
        <Action
          label="Use current account"
          secondary
          disabled={!connected || busy}
          onPress={acceptCurrentAccount}
        />
      )}
      {!!taskCreation.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {taskCreation.error}
        </Text>
      )}
      {!detail && (
        <Text style={[styles.muted, styles.content]}>
          {error || (connected ? 'Loading PR details…' : 'Connect to the runtime.')}
        </Text>
      )}
      {detail && (
        <>
          <PullTabs
            value={tab}
            onChange={(value) => {
              setFragment('')
              setTab(value)
              body.current?.scrollTo({
                y: 0,
                animated: false,
              })
              if (value === 'changes') setChangesOpened(true)
            }}
            items={[
              {
                id: 'overview',
                name: 'Overview',
              },
              {
                id: 'changes',
                name: 'Files',
              },
              {
                id: 'discussion',
                name: 'Activity',
              },
              {
                id: 'checks',
                name: 'Checks',
              },
            ]}
          />
          <ScrollView
            ref={body}
            testID="PR detail content"
            contentContainerStyle={styles.content}
            refreshControl={
              connected ? (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={refresh}
                  tintColor={colors.muted}
                />
              ) : undefined
            }
          >
            <View ref={content} collapsable={false} style={{ gap: 12 }}>
              {!!fragment && !destination?.comment && (
                <Text style={styles.muted}>
                  This linked section is not available in the loaded PR. Use the server action to
                  open the original link.
                </Text>
              )}
              {!!error && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              )}
              {(detail.stale || detail.refreshError || !connected) && (
                <Text style={styles.muted}>
                  {!connected
                    ? 'Offline · showing last loaded details.'
                    : detail.refreshError
                      ? `Refresh failed: ${detail.refreshError}`
                      : 'Showing cached details · refreshing.'}
                  {detail.cachedAt ? ` Last fetched ${formatTime(new Date(detail.cachedAt))}.` : ''}
                </Text>
              )}
              {detail.warnings.map((warning) => (
                <Text key={warning} accessibilityRole="alert" style={styles.error}>
                  {warning}
                </Text>
              ))}
              <View
                style={{
                  display: tab === 'overview' ? 'flex' : 'none',
                  gap: 20,
                }}
              >
                <View
                  style={{
                    gap: 8,
                  }}
                >
                  <Text
                    selectable
                    accessibilityRole="header"
                    style={[
                      styles.title,
                      {
                        fontSize: 22,
                        lineHeight: 28,
                      },
                    ]}
                  >
                    {detail.pull.title}
                  </Text>
                  <View style={styles.row}>
                    <PullRequestIcon state={detail.pull.state} draft={detail.pull.draft} />
                    <Signal signal={pullState(detail.pull)} emphasis />
                    <Text style={styles.muted}>·</Text>
                    <Text
                      style={[
                        styles.muted,
                        {
                          flexShrink: 1,
                        },
                      ]}
                    >
                      {detail.pull.author}
                    </Text>
                  </View>
                  <Text selectable style={styles.muted}>
                    {detail.pull.head} → {detail.pull.base}
                  </Text>
                  {repository && (detail.stack || detail.pull.state === 'open') && (
                    <View style={[styles.card, { gap: 10 }]}>
                      <View style={styles.row}>
                        <Icon name="stack" size={16} color={colors.accent} />
                        <Text style={styles.text}>
                          {detail.stack ? pullStackLabel(detail.stack) : 'Build a stack'}
                        </Text>
                      </View>
                      {detail.stack?.members.map((pull) => (
                        <Pressable
                          key={pull.number}
                          accessibilityRole="button"
                          accessibilityLabel={`Open PR #${pull.number}: ${pull.title}`}
                          disabled={pull.number === number || !profile}
                          onPress={() => {
                            if (profile)
                              navigateAfterSheet(() =>
                                router.push(pullHref(profile.id, repositoryId, pull.number)),
                              )
                          }}
                          style={{ paddingVertical: 8, paddingLeft: pull.depth * 12 }}
                        >
                          <Text
                            style={{ color: pull.number === number ? colors.text : colors.accent }}
                          >
                            #{pull.number} · {pull.title}
                          </Text>
                          <Text style={styles.muted}>
                            {pull.parentNumber ? `Depends on #${pull.parentNumber}` : 'Base PR'}
                          </Text>
                        </Pressable>
                      ))}
                      {detail.stack && !detail.stack.complete && (
                        <Text style={styles.muted}>
                          Partial stack. Refresh and verify dependencies before updating.
                        </Text>
                      )}
                      <Action
                        secondary
                        label="Stack a PR"
                        disabled={
                          !connected || detail.pull.state !== 'open' || !pullHeadBranch(detail.pull)
                        }
                        onPress={() => {
                          stackOrigin.current = detail
                          setCreatingStack(true)
                        }}
                      />
                      {detail.stack && (
                        <Action
                          secondary
                          label="Ask agent to update stack"
                          disabled={!connected || detail.stale || taskCreation.busy}
                          onPress={() => taskCreation.start('new-branch', 'update')}
                        />
                      )}
                    </View>
                  )}
                  <View
                    style={{
                      gap: 5,
                      paddingVertical: 10,
                      borderTopWidth: 0.5,
                      borderBottomWidth: 0.5,
                      borderColor: colors.border,
                    }}
                  >
                    <Text style={styles.text}>
                      {detail.pull.changedFiles === null
                        ? 'File count unavailable'
                        : `${detail.pull.changedFiles} changed files`}
                      {detail.pull.additions !== null && detail.pull.deletions !== null
                        ? ` · +${detail.pull.additions} / −${detail.pull.deletions}`
                        : ''}
                    </Text>
                    <Text style={styles.muted}>
                      Reviewers: {detail.pull.reviewers.join(', ') || 'None requested'}
                    </Text>
                    <Text style={styles.muted}>
                      Assigned to: {detail.pull.assignees.join(', ') || 'Unassigned'}
                    </Text>
                    <Text style={styles.muted}>
                      Updated {formatDateTime(detail.pull.updatedAt)}
                    </Text>
                  </View>
                  <View style={styles.row}>
                    <Signal signal={pullDetailChecks(detail)} />
                    <Text style={styles.muted}>·</Text>
                    <Signal signal={pullDetailReviews(detail)} />
                    <Text style={styles.muted}>·</Text>
                    <Signal signal={pullMergeability(detail.pull)} />
                  </View>
                </View>
                <View
                  style={{
                    borderTopWidth: 0.5,
                    borderColor: colors.border,
                    paddingTop: 16,
                  }}
                >
                  <Markdown
                    text={detail.pull.body || 'No description provided.'}
                    baseURL={detail.pull.url}
                    fileBaseURL={fileBaseURL}
                    preserveLineBreaks
                  />
                </View>
                <View
                  style={{
                    borderTopWidth: 0.5,
                    borderColor: colors.border,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="People and labels"
                    accessibilityState={{
                      expanded: metadataOpen,
                    }}
                    onPress={() => setMetadataOpen(!metadataOpen)}
                    style={({ pressed }) => [
                      styles.row,
                      {
                        flexWrap: 'nowrap',
                        minHeight: 44,
                        opacity: pressed ? 0.55 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.text,
                        {
                          flex: 1,
                          fontSize: 15,
                        },
                      ]}
                    >
                      People and labels
                    </Text>
                    <Icon name={metadataOpen ? 'down' : 'next'} size={13} color={colors.muted} />
                  </Pressable>
                  {metadataOpen && (
                    <View
                      style={{
                        gap: 8,
                        paddingBottom: 12,
                      }}
                    >
                      <Text style={styles.muted}>Requested reviewers</Text>
                      <Text style={styles.text}>{detail.pull.reviewers.join(', ') || 'None'}</Text>
                      <Text style={styles.muted}>Assignees</Text>
                      <Text style={styles.text}>
                        {detail.pull.assignees.join(', ') || 'No one'}
                      </Text>
                      <Text style={styles.muted}>Labels</Text>
                      <Text style={styles.text}>
                        {detail.pull.labels.join(' · ') || 'No labels'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <View
                style={{
                  display: tab === 'discussion' ? 'flex' : 'none',
                }}
              >
                <View
                  style={{
                    gap: 12,
                  }}
                >
                  <Text style={styles.muted}>
                    {discussion.filter((comment) => comment.kind === 'review').length} reviews ·{' '}
                    {discussion.filter((comment) => comment.kind === 'comment').length} discussion
                    comments
                  </Text>
                  <PullComments
                    comments={discussion}
                    fragment={fragment}
                    onAnchor={tab === 'discussion' ? scrollToAnchor : undefined}
                    onOpen={open}
                    fileBaseURL={fileBaseURL}
                    onAction={actionDisabled ? undefined : openAction}
                    capabilities={detail.capabilities}
                  />
                </View>
              </View>
              <View
                style={{
                  display: tab === 'checks' ? 'flex' : 'none',
                }}
              >
                {repository && (
                  <Action
                    secondary
                    label="View pipeline runs for this commit"
                    disabled={!profile || !detail.pull.headSha}
                    onPress={() => {
                      if (profile && detail.pull.headSha)
                        navigateAfterSheet(() =>
                          router.push(
                            pipelineRunsHref(profile.id, repositoryId, detail.pull.headSha, number),
                          ),
                        )
                    }}
                  />
                )}
                <PullStatus detail={detail} onOpen={open} />
              </View>
              <View
                style={{
                  display: tab === 'changes' ? 'flex' : 'none',
                }}
              >
                {changesOpened && (
                  <PullChanges
                    active={tab === 'changes'}
                    key={`${repositoryId}:${detail.pull.number}`}
                    repositoryId={repositoryId}
                    detail={detail}
                    initialPath={destination?.path}
                    fragment={fragment}
                    onAnchor={tab === 'changes' ? scrollToAnchor : undefined}
                    onOpen={open}
                    onAction={actionDisabled ? undefined : openAction}
                    onLineComment={
                      actionDisabled
                        ? undefined
                        : (path) => {
                            lineOrigin.current = detail
                            setLineComment(path)
                          }
                    }
                  />
                )}
              </View>
            </View>
          </ScrollView>
          <PullPrimaryAction
            option={actions?.primary}
            onAction={openAction}
            disabled={actionDisabled}
          />
        </>
      )}
      {creatingStack && detail && (
        <CreatePull
          repositoryId={repositoryId}
          initialParent={(stackOrigin.current ?? detail).pull}
          onClose={() => setCreatingStack(false)}
          onCreated={(repo, next) => {
            onPosted()
            setCreatingStack(false)
            if (profile) navigateAfterSheet(() => router.push(pullHref(profile.id, repo, next)))
          }}
        />
      )}
      {action && detail && (
        <PullActionSheet
          repositoryId={repositoryId}
          detail={actionOrigin.current ?? detail}
          target={action}
          onClose={() => setAction(null)}
          onDone={onPosted}
        />
      )}
      {lineComment && detail && (
        <LineComment
          repositoryId={repositoryId}
          detail={lineOrigin.current ?? detail}
          path={lineComment}
          onClose={() => setLineComment(null)}
          onDone={onPosted}
        />
      )}
    </View>
  )
}
