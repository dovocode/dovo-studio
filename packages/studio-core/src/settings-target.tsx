import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { resolveSettingsTarget, type SettingsTarget } from '@dovo/protocol'
import { useConfirmation } from './confirmation'
import { useApplicationState } from './runtime/application-state'
import { useWorkspace } from './workspace/provider'
import { useRuntimeSources } from './workspace/runtime-sources'

type DraftScope = 'settings' | 'workspace'
const DraftScopeContext = createContext<DraftScope>('settings')

export function WorkspaceDraftScope({ children }: { children: ReactNode }) {
  return <DraftScopeContext.Provider value="workspace">{children}</DraftScopeContext.Provider>
}

const Context = createContext<{
  target: SettingsTarget
  hasDraft: boolean
  setTarget: (target: SettingsTarget) => Promise<boolean>
  confirmNavigation: (scope?: DraftScope | 'all') => Promise<boolean>
  registerDraft: (id: symbol, scope: DraftScope, dirty: boolean, saving: boolean) => () => void
} | null>(null)
export function SettingsTargetProvider({ children }: { children: ReactNode }) {
  const [target, updateTarget] = useApplicationState<SettingsTarget>({
    environmentId: '',
    projectId: '',
  })
  const drafts = useRef(new Map<symbol, { scope: DraftScope; dirty: boolean; saving: boolean }>())
  const [hasDraft, setHasDraft] = useState(false)
  const currentTarget = useRef(target)
  currentTarget.current = target
  const registerDraft = useCallback(
    (id: symbol, scope: DraftScope, dirty: boolean, saving: boolean) => {
      const update = () =>
        setHasDraft(
          [...drafts.current.values()].some(
            (draft) => draft.scope === 'settings' && (draft.dirty || draft.saving),
          ),
        )
      drafts.current.set(id, { scope, dirty, saving })
      update()
      return () => {
        drafts.current.delete(id)
        update()
      }
    },
    [],
  )
  const confirm = useConfirmation()
  const attempt = useRef(0)
  const confirmNavigation = useCallback(
    async (scope: DraftScope | 'all' = 'settings') => {
      const decision = ++attempt.current
      const current = currentTarget.current
      const values = () =>
        [...drafts.current.values()].filter((draft) => scope === 'all' || draft.scope === scope)
      if (values().some((draft) => draft.saving)) return false
      if (
        values().some((draft) => draft.dirty) &&
        !(await confirm({
          title:
            scope === 'settings' ? 'Discard unsaved settings changes?' : 'Discard unsaved changes?',
          description:
            scope === 'settings'
              ? 'Your edits will be lost when you leave these settings.'
              : 'Your edits will be lost when you leave this view.',
          confirmLabel: 'Discard changes',
          destructive: true,
        }))
      )
        return false
      return (
        decision === attempt.current &&
        currentTarget.current === current &&
        !values().some((draft) => draft.saving)
      )
    },
    [confirm],
  )
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
    <Context.Provider value={{ target, hasDraft, setTarget, confirmNavigation, registerDraft }}>
      {children}
    </Context.Provider>
  )
}
export function useSettingsDraft(dirty: boolean, saving = false) {
  const context = useContext(Context)
  const scope = useContext(DraftScopeContext)
  const id = useRef(Symbol('settings-draft'))
  useLayoutEffect(
    () => context?.registerDraft(id.current, scope, dirty, saving),
    [context?.registerDraft, scope, dirty, saving],
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
  const confirm = useContext(Context)?.confirmNavigation ?? allowSettingsNavigation
  const scope = useContext(DraftScopeContext)
  return useCallback(
    (requestedScope: DraftScope | 'all' = scope) => confirm(requestedScope),
    [confirm, scope],
  )
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
  const { target, hasDraft } = context
  const previous = useRef<{ target: SettingsTarget; ownerId: string } | undefined>(undefined)
  const ownerId =
    hasDraft && previous.current?.target === target ? previous.current.ownerId : undefined
  const resolved = resolveSettingsTarget(sources, target, activeRuntimeId, ownerId)
  const selectedId = resolved.source?.profile.id
  useLayoutEffect(() => {
    if (selectedId) previous.current = { target, ownerId: selectedId }
  }, [target, selectedId])
  return { ...context, sources, ...resolved }
}
