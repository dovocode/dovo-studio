import { useApplicationState } from '../runtime/state/application-state'
import { useEffect, useRef, type ReactNode } from 'react'
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { aggregateRuntimeTasks } from '@dovo/protocol'
import { useAppActive } from '../runtime/state/app-active'
import { useRuntime } from '../runtime/connection/provider'
import { useMobilePreferences } from '../runtime/preferences/app-preferences'

export function TaskWidgetProvider({ children }: { children: ReactNode }) {
  const { overviews } = useRuntime()
  const { widgetUpdates } = useMobilePreferences()
  const active = useAppActive()
  const [supported] = useApplicationState(
    () => Platform.OS === 'ios' && !!requireOptionalNativeModule('ExpoWidgets'),
  )
  const written = useRef('')
  const latest = useRef<{
    running: number
    waiting: number
    items: { title: string; status: string; url: string }[]
  }>({
    running: 0,
    waiting: 0,
    items: [],
  })
  const rows = (
    active && supported && widgetUpdates ? aggregateRuntimeTasks(overviews, Date.now(), true) : []
  )
    .filter(
      (row) =>
        !row.task.archived &&
        !row.task.archivedAt &&
        (row.task.status === 'running' || row.needsInput),
    )
    .sort((a, b) => Number(b.needsInput) - Number(a.needsInput))
  latest.current = {
    running: rows.filter((row) => row.task.status === 'running').length,
    waiting: rows.filter((row) => row.needsInput).length,
    items: rows.slice(0, 5).map((row) => ({
      title: row.task.title,
      status: row.needsInput ? 'Needs input' : 'Working',
      url: `dovo://thread/${encodeURIComponent(row.runtimeId)}/${encodeURIComponent(row.task.id)}`,
    })),
  }
  const fingerprint = JSON.stringify(latest.current)
  useEffect(() => {
    if (!active || !supported || !widgetUpdates) return
    if (written.current === fingerprint) return
    // Streaming text does not change the widget. Coalesce bursts of actual status changes.
    let disposed = false
    const timer = setTimeout(() => {
      void import('./tasks-widget')
        .then((widget) => {
          if (disposed) return
          widget.default.updateSnapshot(latest.current)
          if (!disposed) written.current = fingerprint
        })
        .catch((error: unknown) => console.error('Could not update task widget', error))
    }, 1000)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [active, supported, fingerprint, widgetUpdates])
  return children
}
