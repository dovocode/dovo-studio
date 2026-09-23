import { nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import { usePullDetail } from './use-pull-detail'
import { Markdown } from '../ui/markdown'
import { router } from 'expo-router'
import { pipelineRunsHref } from '../shell/source-route'
import { useRef } from 'react'
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import {
  pullState,
  pullDetailChecks,
  pullDetailReviews,
  pullMergeability,
  forgeLabels,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { colors, styles } from '../ui/theme'
import { Icon } from '../ui/icon'
import { PullComments } from './pull-comments'
import { PullChanges } from './pull-changes'
import { StartPullTask } from './start-pull-task'
import { PullTabs } from './pull-tabs'
import { PullStatus, Signal } from './pull-status'
import { ScreenHeader } from '../ui/screen-header'
import { PullMenu } from './pull-menu'
import { PullPrimaryAction, PullActionSheet, type PullActionTarget } from './pull-actions'
import { pullActionOptions } from './pull-action-options'
import { LineComment } from './line-comment'
import { invalidatePullList } from './pull-list-invalidation'
export function PullDetail({
  repositoryId,
  number,
  onBack,
}: {
  repositoryId: string
  number: number
  onBack: () => void
}) {
  const { connected, snapshot, profile, readCache } = useRuntime()
  const body = useRef<ScrollView>(null)
  const { detail, error, setError, busy, refreshing, refresh, invalidate } = usePullDetail(
    repositoryId,
    number,
  )
  const onPosted = () => {
    invalidate()
    invalidatePullList(readCache, repositoryId)
  }
  const [starting, setStarting] = useApplicationState(false),
    [tab, setTab] = useApplicationState('overview'),
    [changesOpened, setChangesOpened] = useApplicationState(false),
    [metadataOpen, setMetadataOpen] = useApplicationState(false)
  const [action, setAction] = useApplicationState<PullActionTarget | null>(null)
  const [lineComment, setLineComment] = useApplicationState<string | null>(null)
  const open = (url: string) => {
    void runClientEffect(
      nativeEffect(() => Linking.openURL(url)).pipe(
        Effect.catchAll((error) => nativeEffect(() => setError(String(error)))),
      ),
    )
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
    if (!actionDisabled) setAction(target)
  }
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={`PR #${number}`}
        subtitle={[
          snapshot?.workspace.repositories.find((repo) => repo.id === repositoryId)?.name,
          profile?.name,
        ]
          .filter(Boolean)
          .join(' · ')}
        leading={<Action secondary label="Back to PRs" onPress={onBack} />}
        actions={
          detail ? (
            <PullMenu
              providerName={forgeLabels[detail.pull.provider ?? 'github']}
              onRefresh={refresh}
              onOpen={() => open(detail.pull.url)}
              onStartTask={() => setStarting(true)}
              refreshDisabled={!connected || refreshing}
              taskDisabled={!connected}
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
                {detail.cachedAt
                  ? ` Last fetched ${new Date(detail.cachedAt).toLocaleTimeString()}.`
                  : ''}
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
                  onPress={() => setMetadataOpen((value) => !value)}
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
                    <Text style={styles.text}>{detail.pull.assignees.join(', ') || 'No one'}</Text>
                    <Text style={styles.muted}>Labels</Text>
                    <Text style={styles.text}>{detail.pull.labels.join(' · ') || 'No labels'}</Text>
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
                  onOpen={open}
                  fileBaseURL={fileBaseURL}
                  onAction={actionDisabled ? undefined : setAction}
                  capabilities={detail.capabilities}
                />
              </View>
            </View>
            <View
              style={{
                display: tab === 'checks' ? 'flex' : 'none',
              }}
            >
              <Action
                secondary
                label="View pipeline runs for this commit"
                disabled={!profile || !detail.pull.headSha}
                onPress={() => {
                  if (profile && detail.pull.headSha)
                    router.push(
                      pipelineRunsHref(profile.id, repositoryId, detail.pull.headSha, number),
                    )
                }}
              />
              <PullStatus detail={detail} onOpen={open} />
            </View>
            <View
              style={{
                display: tab === 'changes' ? 'flex' : 'none',
              }}
            >
              {changesOpened && (
                <PullChanges
                  key={detail.pull.headSha}
                  detail={detail}
                  onOpen={open}
                  onAction={actionDisabled ? undefined : setAction}
                  onLineComment={actionDisabled ? undefined : setLineComment}
                />
              )}
            </View>
          </ScrollView>
          <PullPrimaryAction
            option={actions?.primary}
            onAction={openAction}
            disabled={actionDisabled}
          />
        </>
      )}
      {starting && detail && (
        <StartPullTask
          repositoryId={repositoryId}
          pull={detail.pull}
          onBack={() => setStarting(false)}
        />
      )}
      {action && detail && (
        <PullActionSheet
          repositoryId={repositoryId}
          detail={detail}
          target={action}
          onClose={() => setAction(null)}
          onDone={onPosted}
        />
      )}
      {lineComment && detail && (
        <LineComment
          repositoryId={repositoryId}
          detail={detail}
          path={lineComment}
          onClose={() => setLineComment(null)}
          onDone={onPosted}
        />
      )}
    </View>
  )
}
