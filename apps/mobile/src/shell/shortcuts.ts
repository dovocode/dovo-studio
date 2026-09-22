import { useEffect, useState, useRef } from 'react'
import { Linking } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { randomUUID } from 'expo-crypto'
import { z } from 'zod'
const item = z.object({
  id: z.string(),
  text: z.string().min(1).max(12000),
  title: z.string().max(200),
  repositoryId: z.string(),
  agentId: z.string(),
})
export type ShortcutInput = z.infer<typeof item>
const storage = 'dovo.shortcut.inbox'
export function useShortcuts() {
  const [queue, setQueue] = useState<ShortcutInput[]>([]),
    [error, setError] = useState('')
  const pending = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    let stopped = false,
      lastUrl = '',
      lastTime = 0
    const receive = (url: string) => {
      pending.current = pending.current
        .then(async () => {
          if (stopped) return
          const link = new URL(url)
          if (link.protocol !== 'dovo:' || link.hostname !== 'task') return
          if (lastUrl === url && Date.now() - lastTime < 1000) return
          lastUrl = url
          lastTime = Date.now()
          const next = item.parse({
            id: randomUUID(),
            text: link.searchParams.get('text') ?? '',
            title: link.searchParams.get('title') ?? 'Shortcut task',
            repositoryId: link.searchParams.get('repositoryId') ?? '',
            agentId: link.searchParams.get('agentId') ?? '',
          })
          const saved = z
            .array(item)
            .parse(JSON.parse((await AsyncStorage.getItem(storage)) ?? '[]'))
          const updated = [...saved, next]
          await AsyncStorage.setItem(storage, JSON.stringify(updated))
          if (!stopped) setQueue(updated)
        })
        .catch((e) => {
          if (!stopped) setError(String(e))
        })
    }
    pending.current = AsyncStorage.getItem(storage)
      .then((value) => {
        if (!stopped) setQueue(z.array(item).parse(JSON.parse(value ?? '[]')))
      })
      .catch((e) => {
        if (!stopped) setError(String(e))
      })
    void Linking.getInitialURL()
      .then((url) => {
        if (url) receive(url)
      })
      .catch((e) => setError(String(e)))
    const listener = Linking.addEventListener('url', (e) => receive(e.url))
    return () => {
      stopped = true
      listener.remove()
    }
  }, [])
  const consume = (id: string) => {
    const result = pending.current.then(async () => {
      const saved = z.array(item).parse(JSON.parse((await AsyncStorage.getItem(storage)) ?? '[]'))
      const next = saved.filter((i) => i.id !== id)
      await AsyncStorage.setItem(storage, JSON.stringify(next))
      setQueue(next)
    })
    pending.current = result.catch((e) => setError(String(e)))
    return result
  }

  return { input: queue[0], consume, error }
}
