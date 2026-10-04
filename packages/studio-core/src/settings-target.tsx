import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import { resolveSettingsTarget, type SettingsTarget } from '@dovo/protocol'
import { useApplicationState } from './runtime/application-state'
import { useWorkspace } from './workspace/provider'
import { useRuntimeSources } from './workspace/runtime-sources'

const Context = createContext<{
  target: SettingsTarget
  setTarget: (target: SettingsTarget) => void
  confirmNavigation: () => boolean
  registerDraft: (id: symbol, dirty: boolean, saving: boolean) => () => void
} | null>(null)
export function SettingsTargetProvider({ children }: { children: ReactNode }) {
  const [target, updateTarget] = useApplicationState<SettingsTarget>({
    environmentId: '',
    projectId: '',
  })
  const drafts = useRef(new Map<symbol, { dirty: boolean; saving: boolean }>())
  const currentTarget = useRef(target)
  currentTarget.current = target
  const registerDraft = useCallback((id: symbol, dirty: boolean, saving: boolean) => {
    drafts.current.set(id, { dirty, saving })
    return () => {
      drafts.current.delete(id)
    }
  }, [])
  const confirmNavigation = useCallback(() => {
    const values = [...drafts.current.values()]
    return (
      !values.some((draft) => draft.saving) &&
      (!values.some((draft) => draft.dirty) || window.confirm('Discard unsaved settings changes?'))
    )
  }, [])
  const setTarget = useCallback(
    (next: SettingsTarget) => {
      const current = currentTarget.current
      if (next.environmentId === current.environmentId && next.projectId === current.projectId)
        return
      if (confirmNavigation()) updateTarget(next)
    },
    [updateTarget, confirmNavigation],
  )
  return (
    <Context.Provider value={{ target, setTarget, confirmNavigation, registerDraft }}>
      {children}
    </Context.Provider>
  )
}
export function useSettingsDraft(dirty: boolean, saving = false) {
  const context = useContext(Context)
  const id = useRef(Symbol('settings-draft'))
  useEffect(
    () => context?.registerDraft(id.current, dirty, saving),
    [context?.registerDraft, dirty, saving],
  )
  useEffect(() => {
    if (!dirty) return
    const protect = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [dirty])
}
export function useConfirmSettingsNavigation() {
  const context = useContext(Context)
  return context?.confirmNavigation ?? (() => true)
}
export function useSettingsTarget() {
  const context = useContext(Context)
  if (!context) throw new Error('SettingsTargetProvider is required')
  const sources = useRuntimeSources()
  const { activeRuntimeId } = useWorkspace()
  return { ...context, sources, ...resolveSettingsTarget(sources, context.target, activeRuntimeId) }
}
