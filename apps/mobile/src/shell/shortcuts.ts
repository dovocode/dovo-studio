import { clientTaskScope, runClientEffect } from '@dovo/client-runtime'
import { nativeEffect, mobileWorkflow } from '../runtime/state/native-effect'
import { useApplicationState } from '../runtime/state/application-state'
import { mutableStruct } from '@dovo/protocol'
import { minValue, maxValue, decode, decodeResult } from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import {
  ingestSharedHandoffs,
  removeInboxEntry,
  restoreShortcutInbox,
  SHORTCUT_INBOX_STORAGE,
} from './shared-inbox'
import {
  pendingSharedHandoffs,
  acknowledgeSharedHandoff,
  ownSharedFiles,
  sharedFilesSchema,
  releaseSharedFiles,
  cleanupSharedFiles,
} from './shared-files'
import { AppState, Linking } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { randomUUID } from 'expo-crypto'
import { Schema, Effect, Semaphore } from 'effect'
const item = mutableStruct({
  id: Schema.String,
  text: maxValue(Schema.String, 12000),
  title: maxValue(Schema.String, 200),
  repositoryId: Schema.String,
  agentId: Schema.String,
  source: Schema.optional(Schema.Literal('share')),
  files: Schema.optional(sharedFilesSchema),
  shareError: Schema.optional(Schema.String),
})
export type ShortcutInput = Schema.Schema.Type<typeof item>
const storage = SHORTCUT_INBOX_STORAGE
// Inbox writes belong to the app, including while React replaces its root.
const inboxLock = Semaphore.makeUnsafe(1)
const readInbox = nativeEffect(() =>
  restoreShortcutInbox({
    read: (key) => AsyncStorage.getItem(key),
    write: (key, value) => AsyncStorage.setItem(key, value),
    decode: (entry) => {
      const result = decodeResult(item, entry)
      return result.success ? result.data : undefined
    },
    cleanup: cleanupSharedFiles,
  }),
)
export function useShortcuts() {
  const [queue, setQueue] = useApplicationState<ShortcutInput[]>([])
  const [error, setError] = useApplicationState('')
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    let stopped = false,
      lastUrl = '',
      lastTime = 0
    const commands = clientTaskScope()
    const report = (cause: unknown) =>
      Effect.sync(() => {
        if (!stopped) setError(String(cause))
      })
    const receiveShare = () => {
      void commands.run(
        inboxLock
          .withPermits(1)(
            mobileWorkflow(function* () {
              if (stopped) return
              const saved = yield* readInbox
              const handoffs = yield* nativeEffect(() => pendingSharedHandoffs())
              const updated = yield* nativeEffect(() =>
                ingestSharedHandoffs(saved, handoffs, {
                  ownFiles: ownSharedFiles,
                  save: async (items) => {
                    await AsyncStorage.setItem(storage, JSON.stringify(items))
                    if (!stopped) setQueue(items)
                  },
                  acknowledge: acknowledgeSharedHandoff,
                }),
              )
              if (!stopped) setError('')
              if (!stopped) setQueue(updated)
            }).pipe(Effect.uninterruptible),
          )
          .pipe(Effect.catch(report)),
      )
    }
    const receive = (url: string) => {
      void commands.run(
        inboxLock
          .withPermits(1)(
            mobileWorkflow(function* () {
              if (stopped) return
              const link = new URL(url)
              if (link.protocol !== 'dovo:' || link.hostname !== 'task') return
              if (lastUrl === url && Date.now() - lastTime < 1000) return
              const next = decode(item, {
                id: randomUUID(),
                text: decode(
                  maxValue(minValue(Schema.String, 1), 12000),
                  link.searchParams.get('text') ?? '',
                ),
                title: link.searchParams.get('title') ?? 'Shortcut task',
                repositoryId: link.searchParams.get('repositoryId') ?? '',
                agentId: link.searchParams.get('agentId') ?? '',
              })
              const saved = yield* readInbox
              const updated = [...saved, next]
              yield* nativeEffect(() => AsyncStorage.setItem(storage, JSON.stringify(updated)))
              lastUrl = url
              lastTime = Date.now()
              if (!stopped) setQueue(updated)
            }).pipe(Effect.uninterruptible),
          )
          .pipe(Effect.catch(report)),
      )
    }
    void commands.run(
      inboxLock
        .withPermits(1)(readInbox)
        .pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              if (!stopped) setQueue(value)
            }),
          ),
          Effect.asVoid,
          Effect.catch(report),
        ),
    )
    void commands.run(
      nativeEffect(() => Linking.getInitialURL()).pipe(
        Effect.tap((url) =>
          Effect.sync(() => {
            if (url && !stopped) receive(url)
          }),
        ),
        Effect.asVoid,
        Effect.catch(report),
      ),
    )
    receiveShare()
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') receiveShare()
    })
    const listener = Linking.addEventListener('url', (event) => {
      receive(event.url)
      receiveShare()
    })
    return () => {
      stopped = true
      mounted.current = false
      listener.remove()
      foreground.remove()
      void commands.stop()
    }
  }, [])
  const consume = (id: string) =>
    runClientEffect(
      inboxLock
        .withPermits(1)(
          mobileWorkflow(function* () {
            const saved = yield* readInbox
            const next = yield* nativeEffect(() =>
              removeInboxEntry(saved, id, {
                acknowledge: acknowledgeSharedHandoff,
                save: (items) => AsyncStorage.setItem(storage, JSON.stringify(items)),
                release: releaseSharedFiles,
              }),
            )
            if (mounted.current) setQueue(next)
          }).pipe(Effect.uninterruptible),
        )
        .pipe(
          Effect.tapError((cause) =>
            Effect.sync(() => {
              if (mounted.current) setError(String(cause))
            }),
          ),
        ),
    )
  return { input: queue[0], consume, error }
}
