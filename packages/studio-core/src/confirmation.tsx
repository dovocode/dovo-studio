import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { clientScopeKey } from '@dovo/client-runtime'
import { useWorkspace } from './workspace/context'

export interface ConfirmationOptions {
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  details?: string
}

export type RequestConfirmation = (
  options: ConfirmationOptions,
  signal: AbortSignal,
) => Promise<boolean>

export const ConfirmationContext = createContext<RequestConfirmation | null>(null)

/** Pending decisions belong to the caller and its captured runtime, never a later workspace. */
export function useConfirmation(contextKey?: string) {
  const request = useContext(ConfirmationContext)
  const { connection, activeRuntimeId } = useWorkspace()
  const scope = JSON.stringify([activeRuntimeId, clientScopeKey(connection), contextKey])
  const currentScope = useRef(scope)
  currentScope.current = scope
  const mounted = useRef(true)
  const pending = useRef(new Set<AbortController>())
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const controller of pending.current) controller.abort()
      pending.current.clear()
    }
  }, [scope])
  return useCallback(
    async (options: ConfirmationOptions) => {
      if (!mounted.current || currentScope.current !== scope) return false
      if (!request) throw new Error('StudioConfirmationProvider is required')
      const controller = new AbortController()
      pending.current.add(controller)
      try {
        const accepted = await request(options, controller.signal)
        return accepted && mounted.current && currentScope.current === scope
      } finally {
        pending.current.delete(controller)
      }
    },
    [request, scope],
  )
}
