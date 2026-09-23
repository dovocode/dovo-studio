import { clientTaskScope, runClientEffect } from '@dovo/client-runtime'
import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { useApplicationState } from '../runtime/application-state'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { minValue, maxValue, decode } from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import { Linking } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { randomUUID } from 'expo-crypto'
import { Schema, Effect } from 'effect'
const item = mutableStruct({
  id: Schema.String,
  text: maxValue(minValue(Schema.String, 1), 12000),
  title: maxValue(Schema.String, 200),
  repositoryId: Schema.String,
  agentId: Schema.String,
})
export type ShortcutInput = Schema.Schema.Type<typeof item>
const storage = 'dovo.shortcut.inbox'
// Inbox writes belong to the app, including while React replaces its root.
const inboxLock = Effect.unsafeMakeSemaphore(1)
const readInbox = mobileWorkflow(function* () {
  const value = yield* nativeEffect(() => AsyncStorage.getItem(storage))
  return decode(mutableArray(item), JSON.parse(value ?? '[]'))
})
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
                text: link.searchParams.get('text') ?? '',
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
          .pipe(Effect.catchAll(report)),
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
          Effect.catchAll(report),
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
        Effect.catchAll(report),
      ),
    )
    const listener = Linking.addEventListener('url', (event) => receive(event.url))
    return () => {
      stopped = true
      mounted.current = false
      listener.remove()
      void commands.stop()
    }
  }, [])
  const consume = (id: string) =>
    runClientEffect(
      inboxLock
        .withPermits(1)(
          mobileWorkflow(function* () {
            const saved = yield* readInbox
            const next = saved.filter((item) => item.id !== id)
            yield* nativeEffect(() => AsyncStorage.setItem(storage, JSON.stringify(next)))
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
