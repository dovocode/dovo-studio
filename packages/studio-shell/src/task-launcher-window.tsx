import { useEffect, useState } from 'react'
import { ApplicationStateProvider } from '@dovo/studio-core/state'
import { LauncherWorkspaceProvider } from '@dovo/studio-core'
import { TooltipProvider, ErrorBoundary } from '@dovo/studio-ui'
import {
  decode,
  runtimeRegistrySchema,
  type RuntimeRegistry,
  type TaskLauncherBridge,
} from '@dovo/protocol'
import { useAppearance } from './appearance'
import { TaskLauncherForm } from './task-launcher'

function Content({ bridge }: { bridge: TaskLauncherBridge }) {
  useAppearance()
  const [registry, setRegistry] = useState<RuntimeRegistry | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let mounted = true
    const load = () => {
      void bridge
        .current()
        .then((value) => {
          if (mounted) {
            setRegistry(decode(runtimeRegistrySchema, value))
            setError('')
          }
        })
        .catch((cause: unknown) => {
          if (mounted) setError(String(cause))
        })
    }
    const unsubscribe = bridge.subscribe(load)
    load()
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [bridge])
  return (
    <main className="h-screen rounded-xl border bg-background text-foreground">
      {error && (
        <p role="alert" className="p-6 text-sm text-destructive">
          {error}
        </p>
      )}
      {registry ? (
        <LauncherWorkspaceProvider registry={registry}>
          <TaskLauncherForm bridge={bridge} />
        </LauncherWorkspaceProvider>
      ) : (
        !error && <p className="p-6 text-sm text-muted-foreground">Loading computers…</p>
      )}
    </main>
  )
}
export function TaskLauncherWindow({ bridge }: { bridge: TaskLauncherBridge }) {
  return (
    <ApplicationStateProvider>
      <TooltipProvider>
        <ErrorBoundary scope="view">
          <Content bridge={bridge} />
        </ErrorBoundary>
      </TooltipProvider>
    </ApplicationStateProvider>
  )
}
