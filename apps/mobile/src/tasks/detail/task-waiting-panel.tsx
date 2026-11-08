import { usePreviewActive } from '../preview/use-preview-active'
import { taskHref } from '../../shell/task-route'
import { useLinkOrigin } from '../../ui/content/link-origin'
import { useCallback, useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { taskWaitingSchema, type taskWaitingRequestSchema } from '@dovo/protocol'
import { clientScopeKey } from '@dovo/client-runtime'
import { router } from 'expo-router'
import { forgePullTarget, pullRepositoryIdentity } from '@dovo/protocol'
import { issueHref, jiraIssueHref, pipelineHref } from '../../shell/source-route'
import { useSheetNavigation } from '../../ui/layout/sheet'
import { useTaskWaiting } from '@dovo/studio-core'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { Icon } from '../../ui/controls/icon'
import { openAppLink } from '../../ui/content/open-link'
import { useTheme } from '../../ui/theme'

export function TaskWaitingPanel({
  taskId,
  onPull,
}: {
  taskId: string
  onPull?: (url: string) => void
}) {
  const active = usePreviewActive()
  const origin = useLinkOrigin(taskId)
  const { call, connected, connection, activeId, snapshot, profiles, overviews } = useRuntime()
  const { styles, colors } = useTheme()
  const [linkError, setLinkError] = useState('')
  const navigateAfterSheet = useSheetNavigation()
  const open = (
    url: string,
    dependency?: { kind: 'pull' | 'pipeline' | 'thread'; repositoryId: string; target: string },
  ) => {
    setLinkError('')
    const pull = forgePullTarget(
      url,
      (snapshot?.workspace.repositories ?? []).map((repo) => ({
        identity: pullRepositoryIdentity(repo),
      })),
    )
    if (pull && onPull) {
      onPull(url)
      return
    }
    const work = snapshot?.workspace.tasks.find((task) => task.id === taskId)?.workItem
    if (activeId && dependency?.kind === 'pipeline') {
      navigateAfterSheet(() =>
        router.push(pipelineHref(activeId, dependency.repositoryId, dependency.target, url)),
      )
    } else if (activeId && pull) {
      navigateAfterSheet(() => {
        void openAppLink(url, false, origin).catch((cause) => setLinkError(String(cause)))
      })
    } else if (activeId && work?.url === url) {
      const task = snapshot?.workspace.tasks.find((task) => task.id === taskId)
      if (!task) return
      const href =
        work.kind === 'pipeline'
          ? pipelineHref(activeId, task.repositoryId, work.id, url)
          : work.jiraSourceId
            ? jiraIssueHref(activeId, work.jiraSourceId, work.id, url)
            : issueHref(activeId, task.repositoryId, work.id, url)
      navigateAfterSheet(() => router.push(href))
    } else
      navigateAfterSheet(() => {
        void openAppLink(url, false, origin).catch((cause) => setLinkError(String(cause)))
      })
  }
  const read = useCallback(
    (input: typeof taskWaitingRequestSchema.Type) =>
      call('/api/tasks/waiting', input, taskWaitingSchema),
    [call],
  )
  const { data, error, busy, refresh } = useTaskWaiting(
    taskId,
    connected,
    read,
    JSON.stringify([clientScopeKey(connection), taskId]),
    active,
  )
  const watchingUrls = new Set(data?.dependencies.map((item) => item.url))
  const related = data?.related?.filter((item) => !watchingUrls.has(item.url)) ?? []
  if (connected && !error && !linkError && !data?.dependencies.length && !related.length)
    return null
  return (
    <View
      accessibilityLabel="Related items and watchers"
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        gap: 4,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      {!connected && (
        <Text style={styles.muted}>
          {data
            ? 'Offline · showing last loaded waiting items. Connect this computer to refresh or stop watching.'
            : 'Offline · connect this computer to load waiting items.'}
        </Text>
      )}
      {linkError && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {linkError}
        </Text>
      )}
      {error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      )}
      {!!related.length && (
        <Text style={[styles.muted, { width: '100%' }]}>Related to this thread</Text>
      )}
      {related.map((item) => (
        <Pressable
          key={item.url}
          accessibilityRole="link"
          accessibilityLabel={`Open ${item.label}`}
          onPress={() => open(item.url)}
          style={{
            borderWidth: 1,
            borderColor: colors.muted,
            borderRadius: 24,
            maxWidth: '100%',
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Text numberOfLines={1} style={styles.text}>
            {item.project} · {item.label}
          </Text>
        </Pressable>
      ))}
      {!!data?.dependencies.length && (
        <Text style={[styles.muted, { width: '100%' }]}>
          Watching · Dovo monitors these for updates
        </Text>
      )}
      {data?.dependencies.map((item) => (
        <View
          key={JSON.stringify([item.kind, item.runtimeId, item.repositoryId, item.target])}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            borderWidth: 1,
            borderColor: colors.muted,
            borderRadius: 24,
            maxWidth: '100%',
          }}
        >
          <Pressable
            accessibilityRole={item.kind === 'thread' ? 'button' : 'link'}
            accessibilityLabel={`Open ${item.label}${item.pausedReason ? `, ${item.pausedReason}` : ''}`}
            onPress={() => {
              if (item.kind !== 'thread') {
                open(item.url, item)
                return
              }
              const savedRuntime = item.runtimeIdentity
                ? (profiles.find((profile) => profile.connection.runtimeId === item.runtimeIdentity)
                    ?.id ??
                  overviews.find((entry) => entry.snapshot?.runtimeId === item.runtimeIdentity)
                    ?.profile.id)
                : undefined
              const owner =
                savedRuntime ??
                (!item.runtimeId || item.runtimeId === 'local' ? activeId : item.runtimeId)
              if (!owner || !activeId) {
                setLinkError('Connect the owning computer to open this thread')
                return
              }
              navigateAfterSheet(() =>
                router.push(
                  taskHref(owner, item.target, undefined, {
                    runtimeId: activeId,
                    taskId,
                    title:
                      snapshot?.workspace.tasks.find((task) => task.id === taskId)?.title ??
                      'Parent thread',
                  }),
                ),
              )
            }}
            style={{
              flexShrink: 1,
              paddingLeft: 10,
              paddingVertical: 8,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Icon name="preview" size={16} color={colors.muted} />
            <View style={{ flexShrink: 1 }}>
              <Text numberOfLines={1} style={styles.text}>
                {item.project} · {item.label}
              </Text>
              {item.kind === 'thread' && <Text style={styles.muted}>{item.status}</Text>}
              {item.kind === 'pipeline' && (
                <Text numberOfLines={1} style={[styles.muted, { fontSize: 10 }]}>
                  {item.lastSuccessAt
                    ? `Last successful poll ${new Date(item.lastSuccessAt).toLocaleString()}`
                    : 'No recorded successful poll'}
                </Text>
              )}
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Stop watching ${item.label}`}
            disabled={!connected || busy}
            style={{ padding: 12, opacity: busy || !connected ? 0.4 : 1 }}
            onPress={() =>
              Alert.alert(
                `Stop watching ${item.label}?`,
                'This stops monitoring this item for this thread.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Stop watching',
                    style: 'destructive',
                    onPress: () =>
                      void refresh({
                        kind: item.kind,
                        ...(item.runtimeId ? { runtimeId: item.runtimeId } : {}),
                        repositoryId: item.repositoryId,
                        target: item.target,
                      }),
                  },
                ],
              )
            }
          >
            <Icon name="close" size={12} color={colors.muted} />
          </Pressable>
          {item.pausedReason && (
            <Text accessibilityLabel={item.pausedReason} style={styles.muted}>
              Paused
            </Text>
          )}
          {item.error && (
            <Text numberOfLines={2} style={{ color: colors.error, flexShrink: 1 }}>
              {item.error}
            </Text>
          )}
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh waiting items"
        disabled={!connected || busy}
        onPress={() => void refresh()}
        style={{ padding: 10 }}
      >
        <Text style={styles.muted}>↻</Text>
      </Pressable>
    </View>
  )
}
