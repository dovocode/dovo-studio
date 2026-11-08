import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import { resolveSettingsTarget, type SettingsTarget } from '@dovo/protocol'
import { useConfirmation } from './confirmation'
import { useApplicationState } from './runtime/application-state'
import { useWorkspace } from './workspace/provider'
import { useRuntimeSources } from './workspace/runtime-sources'

const Context = createContext<{
  target: SettingsTarget
  setTarget: (target: SettingsTarget) => Promise<boolean>
  confirmNavigation: () => Promise<boolean>
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
  const confirm = useConfirmation()
  const attempt = useRef(0)
  const confirmNavigation = useCallback(async () => {
    const decision = ++attempt.current
    const current = currentTarget.current
    const values = [...drafts.current.values()]
    if (values.some((draft) => draft.saving)) return false
    if (
      values.some((draft) => draft.dirty) &&
      !(await confirm({
        title: 'Discard unsaved settings changes?',
        description: 'Your edits will be lost when you leave these settings.',
        confirmLabel: 'Discard changes',
        destructive: true,
      }))
    )
      return false
    return (
      decision === attempt.current &&
      currentTarget.current === current &&
      ![...drafts.current.values()].some((draft) => draft.saving)
    )
  }, [confirm])
  const setTarget = useCallback(
    async (next: SettingsTarget) => {
      const current = currentTarget.current
      if (next.environmentId === current.environmentId && next.projectId === current.projectId) {
        attempt.current++
        return true
      }
      if (!(await confirmNavigation())) return false
      currentTarget.current = next
      updateTarget(next)
      return true
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
const allowSettingsNavigation = async () => true
export function useConfirmSettingsNavigation() {
  const context = useContext(Context)
  return context?.confirmNavigation ?? allowSettingsNavigation
}
/** Scoped controls can also render outside the settings area, where there is no target to move. */
export function useOptionalSettingsTarget() {
  const context = useContext(Context)
  return context ? { target: context.target, setTarget: context.setTarget } : null
}
export function useSettingsTarget() {
  const context = useContext(Context)
  if (!context) throw new Error('SettingsTargetProvider is required')
  const sources = useRuntimeSources()
  const { activeRuntimeId } = useWorkspace()
  return { ...context, sources, ...resolveSettingsTarget(sources, context.target, activeRuntimeId) }
}
