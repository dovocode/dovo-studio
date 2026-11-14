import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  View,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { mergeThreadReplicaPage, threadReplicaPageSchema, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { ScreenHeader } from '../../ui/layout/screen-header'
import { useTheme } from '../../ui/theme'
import { applyOlderReplicaPage, olderReplicaPageFit, replacedReplicaWindow } from './replica-window'

type Message = Task['messages'][number]
/** Within this distance of the newest message, new replies keep the reader at the live end. */
const followDistance = 48

const ReplicaMessage = memo(function ReplicaMessage({ message }: { message: Message }) {
  const { styles } = useTheme()
  return (
    <View style={{ paddingVertical: 12 }}>
      <Text style={styles.muted}>{message.role === 'user' ? 'You' : 'Assistant'}</Text>
      <Text selectable>{message.text}</Text>
    </View>
  )
})
const renderMessage: ListRenderItem<Message> = ({ item }) => <ReplicaMessage message={item} />
const messageKey = (message: Message) => message.id

export function ReplicatedThread({ task, onBack }: { task: Task; onBack: () => void }) {
  const uiText = useInterfaceText()

  const { read, connected } = useRuntime()
  const { styles } = useTheme()
  const [view, setView] = useState(task)
  const [paging, setPaging] = useState(false)
  const pagingRef = useRef(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [following, setFollowing] = useState(true)
  const list = useRef<FlatList<Message>>(null)
  const shown = useRef(view.messages)
  const shownView = useRef(view)
  useLayoutEffect(() => {
    shownView.current = view
  })
  const readGeneration = useRef(0)
  const owner = task.replica
  useEffect(() => {
    setView((current) => mergeThreadReplicaPage(current, task))
  }, [task])
  useEffect(() => {
    if (!owner || !connected) return
    const generation = ++readGeneration.current
    let cancelled = false
    void read(
      '/api/threads/replica/read',
      { ownerRuntimeId: owner.ownerRuntimeId, threadId: owner.threadId },
      threadReplicaPageSchema,
    )
      .then(({ task: latest }) => {
        if (!cancelled && generation === readGeneration.current) {
          setView((current) => mergeThreadReplicaPage(current, latest))
          setError('')
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && generation === readGeneration.current)
          setError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [owner?.ownerRuntimeId, owner?.threadId, task.historyRevision, reload, connected, read])
  const before = view.historyBefore
  const older = useCallback(async () => {
    // Reaching the start fires repeatedly while a page is in flight; request each page once.
    if (!owner || !before || pagingRef.current) return
    pagingRef.current = true
    // Never cancel a newest-page read: it may carry a gap reset that supersedes this page.
    setPaging(true)
    setError('')
    try {
      const result = await read(
        '/api/threads/replica/read',
        { ownerRuntimeId: owner.ownerRuntimeId, threadId: owner.threadId, before },
        threadReplicaPageSchema,
      )
      const fit = olderReplicaPageFit(shownView.current, result.task, before)
      if (fit === 'newer-revision') setReload((value) => value + 1)
      if (fit !== 'apply') return
      // The updater checks again against updates that are not committed yet.
      setView((current) => applyOlderReplicaPage(current, result.task, before))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      pagingRef.current = false
      setPaging(false)
    }
  }, [owner?.ownerRuntimeId, owner?.threadId, before, read])
  // The inverted list starts at the newest message; older pages append at its visual top.
  const newestFirst = useMemo(() => [...view.messages].reverse(), [view.messages])
  // A gap reset or history rewrite replaces the window; the reader returns to its newest message.
  useEffect(() => {
    const previous = shown.current
    shown.current = view.messages
    if (!replacedReplicaWindow(previous, view.messages)) return
    setFollowing(true)
    list.current?.scrollToOffset({ offset: 0, animated: false })
  }, [view.messages])
  const recordScroll = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) =>
      setFollowing(nativeEvent.contentOffset.y <= followDistance),
    [],
  )
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={view.title}
        subtitle={owner?.ownerName}
        leading={<Action label={uiText('Back')} secondary onPress={onBack} />}
      />
      <View style={[styles.content, { paddingBottom: 8 }]}>
        <Text style={styles.muted}>
          {owner?.projectName} · {view.status}
        </Text>
        <Text style={styles.muted}>
          Stored recovery copy. Connect to {owner?.ownerName} to continue this thread.
        </Text>
        <View style={styles.row}>
          <Action
            label="Refresh messages"
            disabled={!connected}
            onPress={() => setReload((value) => value + 1)}
          />
        </View>
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {!view.messages.length && (
          <Text style={styles.muted}>No messages are stored in this recovery copy.</Text>
        )}
      </View>
      <FlatList
        ref={list}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
        data={newestFirst}
        inverted
        renderItem={renderMessage}
        keyExtractor={messageKey}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={9}
        // Reading history keeps its place while new replies arrive below it.
        maintainVisibleContentPosition={following ? undefined : { minIndexForVisible: 0 }}
        onScroll={recordScroll}
        scrollEventThrottle={100}
        onEndReached={() => {
          if (connected && !error) void older()
        }}
        onEndReachedThreshold={1.5}
        // An inverted list renders its footer above the oldest loaded message.
        ListFooterComponent={
          before ? (
            <Action
              label="Load older messages"
              disabled={!connected || paging}
              onPress={() => void older()}
            />
          ) : undefined
        }
      />
    </View>
  )
}
