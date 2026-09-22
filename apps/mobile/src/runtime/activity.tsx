import { useEffect, useState } from 'react'
import { AppState, View } from 'react-native'
import { Text } from '../ui/text'
import { activitySchema } from '@dovo/protocol'
import { useRuntime } from './provider'
import { Action } from '../ui/action'
import { Field } from '../ui/field'
import { styles } from '../ui/theme'
export function ActivityLog() {
  const { call, connected } = useRuntime(),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<ReturnType<typeof activitySchema.parse>>({ events: [] }),
    [error, setError] = useState(''),
    [expanded, setExpanded] = useState('')
  useEffect(() => {
    let stopped = false
    const load = () => {
      if (connected && AppState.currentState === 'active')
        void call('/api/activity', { query, offset }, activitySchema)
          .then((v) => {
            if (!stopped) {
              setData(v)
              setError('')
            }
          })
          .catch((e) => {
            if (!stopped) setError(String(e))
          })
    }
    const initial = setTimeout(load, 250),
      timer = setInterval(load, 10000)
    return () => {
      stopped = true
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [call, connected, query, offset])
  return (
    <View style={{ gap: 8 }}>
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
