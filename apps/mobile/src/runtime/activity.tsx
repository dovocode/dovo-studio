import { startPolling } from '@dovo/client-runtime'
import { useApplicationState } from './application-state'
import { Effect, Schema } from 'effect'
import { useEffect } from 'react'
import { AppState, View } from 'react-native'
import { Text } from '../ui/text'
import { activitySchema } from '@dovo/protocol'
import { useRuntime } from './provider'
import { Action } from '../ui/action'
import { Field } from '../ui/field'
import { styles } from '../ui/theme'
export function ActivityLog() {
  const { readEffect, connected } = useRuntime(),
    [query, setQuery] = useApplicationState(''),
    [offset, setOffset] = useApplicationState(0),
    [data, setData] = useApplicationState<Schema.Schema.Type<typeof activitySchema>>({
      events: [],
    }),
    [error, setError] = useApplicationState(''),
    [expanded, setExpanded] = useApplicationState('')
  useEffect(() => {
    let stopped = false
    let first = true
    const load = Effect.gen(function* () {
      if (first) {
        first = false
        yield* Effect.sleep(250)
      }
      if (!connected || AppState.currentState !== 'active') return
      const value = yield* readEffect('/api/activity', { query, offset }, activitySchema)
      if (!stopped) {
        setData(value)
        setError('')
      }
    })
    const polling = startPolling(load, {
      interval: 10000,
      onError: (error) => {
        if (!stopped) setError(error.message)
      },
    })
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') polling.refresh()
    })
    return () => {
      stopped = true
      subscription.remove()
      void polling.stop()
    }
  }, [readEffect, connected, query, offset])

  return (
    <View
      style={{
        gap: 8,
      }}
    >
      <Text style={styles.title}>Activity & messages</Text>
      <Field
        label="Search activity"
        value={query}
        onChangeText={(v) => {
          setQuery(v)
          setOffset(0)
        }}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      {data.events.map((e) => (
        <View key={e.id} style={styles.card}>
          <Action
            secondary
            label={`${e.kind} · ${e.summary}`}
            onPress={() => setExpanded(expanded === e.id ? '' : e.id)}
          />
          <Text style={styles.muted}>{new Date(e.time).toLocaleString()}</Text>
          {expanded === e.id && (
            <Text selectable style={styles.text}>
              {e.payload}
            </Text>
          )}
        </View>
      ))}
      <View style={styles.row}>
        <Action
          secondary
          label="Newer activity"
          disabled={!offset}
          onPress={() => setOffset((v) => Math.max(0, v - 100))}
        />
        <Action
          secondary
          label="Older activity"
          disabled={data.events.length < 100}
          onPress={() => setOffset((v) => v + 100)}
        />
      </View>
    </View>
  )
}
