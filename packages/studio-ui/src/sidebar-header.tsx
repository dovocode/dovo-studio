import {
  createContext,
  useCallback,
  type Dispatch,
  type SetStateAction,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useApplicationState } from '@dovo/studio-core/state'
import { useCompactLayout } from './use-compact-layout'

const HeaderContext = createContext<{
  brand: ReactNode
  collapsed: boolean
  collapsible: boolean
  setCollapsed?: Dispatch<SetStateAction<boolean>>
  inline: boolean
  compact: boolean
  target: HTMLDivElement | null
  setTarget: (target: HTMLDivElement | null) => void
  register: () => () => void
} | null>(null)

/** Sidebars own the brand row; layouts without a sidebar use the full-width fallback. */
export function SidebarHeaderLayout({
  brand,
  children,
  collapsed = false,
  collapsible = true,
  onCollapsedChange,
}: {
  collapsed?: boolean
  collapsible?: boolean
  onCollapsedChange?: Dispatch<SetStateAction<boolean>>
  brand: ReactNode
  children: ReactNode
}) {
  const compact = useCompactLayout()
  const [sidebars, setSidebars] = useState(0)
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const register = useMemo(
    () => () => {
      setSidebars((count) => count + 1)
      return () => setSidebars((count) => count - 1)
    },
    [],
  )
  const value = useMemo(
    () => ({
      brand,
      collapsed,
      collapsible,
      setCollapsed: onCollapsedChange,
      inline: !compact && sidebars > 0,
      compact,
      target,
      setTarget,
      register,
    }),
    [brand, collapsed, collapsible, onCollapsedChange, compact, sidebars, register, target],
  )
  return (
    <HeaderContext.Provider value={value}>
      <div
        className="studio-header-layout"
        data-inline-header={value.inline}
        data-compact={compact}
        data-sidebar-collapsed={collapsed}
      >
        {children}
      </div>
    </HeaderContext.Provider>
  )
}

export function SidebarHeader({ enabled = true }: { enabled?: boolean }) {
  const context = useContext(HeaderContext)
  const compact = useCompactLayout()
  const register = context?.register
  useLayoutEffect(() => {
    if (enabled && !compact && register) return register()
  }, [enabled, compact, register])
  return enabled && context && !compact && !context.collapsed ? context.brand : null
}

export function HeaderFallback({ children }: { children: ReactNode }) {
  const context = useContext(HeaderContext)
  return context?.inline ? null : children
}

/** Pages without a sidebar share the fallback row with the application brand. */
export function HeaderMainSlot() {
  const context = useContext(HeaderContext)
  return context ? <div className="studio-window-header-slot" ref={context.setTarget} /> : null
}

export function HeaderContent({
  children,
  enabled = true,
}: {
  children: ReactNode
  enabled?: boolean
}) {
  const context = useContext(HeaderContext)
  return enabled && context && !context.compact && !context.inline && context.target
    ? createPortal(<div className="studio-window-header-content">{children}</div>, context.target)
    : children
}

export function useNavigationSidebar() {
  return useContext(HeaderContext)
}

/** Share sidebar visibility with the activity bar; standalone views retain their own state. */
export function useLeftSidebar(initial = true) {
  const context = useContext(HeaderContext)
  const [local, setLocal] = useApplicationState(initial)
  const setCollapsed = context?.setCollapsed
  const setVisible = useCallback<Dispatch<SetStateAction<boolean>>>(
    (next) => {
      if (setCollapsed)
        setCollapsed((collapsed) => !(typeof next === 'function' ? next(!collapsed) : next))
      else setLocal(next)
    },
    [setCollapsed, setLocal],
  )
  return [context?.setCollapsed ? !context.collapsed : local, setVisible] as const
}
