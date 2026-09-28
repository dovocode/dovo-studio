import { useEffect, type ReactNode } from 'react'
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { aggregateRuntimeTasks } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'

export function TaskWidgetProvider({ children }: { children: ReactNode }) {
  const { overviews } = useRuntime()
  useEffect(() => {
    if (Platform.OS !== 'ios' || !requireOptionalNativeModule('ExpoWidgets')) return
    const rows = aggregateRuntimeTasks(overviews, Date.now(), true)
      .filter(
        (row) =>
          !row.task.archived &&
          !row.task.archivedAt &&
          (row.task.status === 'running' || row.needsInput),
      )
      .sort((a, b) => Number(b.needsInput) - Number(a.needsInput))
    const props = {
      running: rows.filter((row) => row.task.status === 'running').length,
      waiting: rows.filter((row) => row.needsInput).length,
      items: rows.slice(0, 5).map((row) => ({
        title: row.task.title,
        status: row.needsInput ? 'Needs input' : 'Working',
        url: `dovo://thread/${encodeURIComponent(row.runtimeId)}/${encodeURIComponent(row.task.id)}`,
      })),
    }
    void import('./tasks-widget')
      .then((widget) => widget.default.updateSnapshot(props))
      .catch((error: unknown) => console.error('Could not update task widget', error))
  }, [overviews])
  return children
}
