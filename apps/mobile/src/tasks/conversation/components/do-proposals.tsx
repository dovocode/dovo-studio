import { useEffect, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { runClientEffect } from '@dovo/client-runtime'
import {
  DO_CHAT_ORIGIN,
  doChatPlansReplySchema,
  type DoRun,
  type Task,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useForegroundInterval } from '../../../runtime/state/app-active'
import { Text } from '../../../ui/content/text'
import { Action } from '../../../ui/controls/action'
import { useTheme } from '../../../ui/theme'
import { doPlansHref } from '../../../do/route'

export function DoProposals({ task, active }: { task: Task; active: boolean }) {
  const { profile } = useRuntime()
  if (task.origin !== DO_CHAT_ORIGIN || !profile) return null
  return (
    <Proposals
      key={JSON.stringify([task.id, profile.connection])}
      taskId={task.id}
      profile={profile}
      active={active}
    />
  )
}

function Proposals({
  taskId,
  profile,
  active,
}: {
  taskId: string
  profile: RuntimeProfile
  active: boolean
}) {
  const { connected, readRuntimeEffect } = useRuntime()
  const { styles } = useTheme()
  const [runs, setRuns] = useState<DoRun[]>([])
  const [error, setError] = useState('')
  const alive = useRef(true)
  const busy = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useForegroundInterval(
    () => {
      if (busy.current) return
      busy.current = true
      void runClientEffect(
        readRuntimeEffect(profile, '/api/do/chat/plans', { taskId }, doChatPlansReplySchema),
      )
        .then((result) => {
          if (alive.current) {
            setRuns(result.runs)
            setError('')
          }
        })
        .catch((cause: unknown) => {
          if (alive.current) setError(cause instanceof Error ? cause.message : String(cause))
        })
        .finally(() => {
          busy.current = false
        })
    },
    active && connected ? 3000 : null,
  )
  if (!runs.length && !error) return null
  return (
    <ScrollView
      style={{ maxHeight: 170, flexGrow: 0 }}
      contentContainerStyle={{ padding: 12, gap: 8 }}
    >
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          Could not refresh proposals: {error}
        </Text>
      )}
      {runs.map((run) => (
        <View key={run.id} style={styles.card}>
          <Text style={styles.text}>{run.title}</Text>
          <Text style={styles.muted}>
            {run.status === 'draft' ? 'Proposed · waiting for your review' : run.status} ·{' '}
            {run.items.filter((item) => item.state.status === 'completed').length}/
            {run.items.length} finished
          </Text>
          <Action
            label={run.status === 'draft' ? 'Review proposal' : 'View work'}
            onPress={() => router.push(doPlansHref(profile.id, run.id))}
          />
        </View>
      ))}
    </ScrollView>
  )
}
