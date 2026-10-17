import type { SubagentListItem } from '@dovo/protocol'
import type { Task } from '@dovo/studio-core'
import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { TaskContextMenu } from '../detail/task-context-menu'
import { TaskRow } from './task-row'
import type { TaskOwner } from './task-collection'

/** List commands addressed by row key, so a row never holds an older entry or list scope. */
export type TaskListRowActions = {
  open: (key: string) => void
  split: (key: string) => void
  template: (key: string, templateId: string) => void
  create: (key: string) => void
  filter: (key: string) => void
  subagent: (key: string, taskId: string) => void
  deselect: () => void
  error: (message: string) => void
  clickCapture: (key: string, event: MouseEvent<HTMLDivElement>) => void
  contextMenuCapture: (key: string) => void
}
/** Large lists mount rows near the viewport and keep measured placeholders elsewhere. */
export type TaskListWindow = {
  /** The scroll container, once committed; rows stay placeholders until it is known. */
  root: HTMLDivElement | null
  scrollTop: RefObject<number>
  height: (key: string, estimate: number) => number
  measure: (key: string, height: number) => void
}
const overscan = 600
const observers = new WeakMap<
  Element,
  { observer: IntersectionObserver; listeners: Map<Element, (visible: boolean) => void> }
>()
function observeRow(element: Element, root: Element, change: (visible: boolean) => void) {
  let shared = observers.get(root)
  if (!shared) {
    const listeners = new Map<Element, (visible: boolean) => void>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting)
      },
      { root, rootMargin: `${overscan}px 0px` },
    )
    shared = { observer, listeners }
    observers.set(root, shared)
  }
  const { observer, listeners } = shared
  listeners.set(element, change)
  observer.observe(element)
  return () => {
    listeners.delete(element)
    observer.unobserve(element)
    if (!listeners.size) {
      observer.disconnect()
      observers.delete(root)
    }
  }
}

function TaskListRowView({
  entryKey,
  task,
  owner,
  subagents,
  needsInput,
  terminals,
  selected,
  selectedMain,
  selectedChildId,
  multiSelected,
  editable,
  disabled,
  menuBusy,
  selectionMenu,
  canSplit,
  canTemplate,
  actions,
  rowWindow,
}: {
  entryKey: string
  task: Task
  owner: TaskOwner
  subagents: readonly SubagentListItem[]
  needsInput: boolean
  terminals: number
  selected: boolean
  selectedMain: boolean
  selectedChildId?: string
  multiSelected: boolean
  editable: boolean
  disabled: boolean
  menuBusy: boolean
  selectionMenu?: ReactNode
  canSplit: boolean
  canTemplate: boolean
  actions: TaskListRowActions
  rowWindow: TaskListWindow | null
}) {
  const element = useRef<HTMLDivElement>(null)
  const estimate = task.archived || task.archivedAt ? 38 : 72 + (subagents.length ? 32 : 0)
  const [visible, setVisible] = useState(!rowWindow)
  // Focus, an open menu or dialog, and a pending action keep their row mounted off-screen.
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(false)
  const mounted = !rowWindow || visible || focused || active
  const focusHandoff = useRef<'first' | 'last' | null>(null)
  useLayoutEffect(() => {
    if (!mounted || !focusHandoff.current || !element.current) return
    const controls = [
      ...element.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]',
      ),
    ].filter((control) => control.tabIndex >= 0 && !control.hidden)
    const target = focusHandoff.current === 'last' ? controls.at(-1) : controls[0]
    focusHandoff.current = null
    target?.focus()
  }, [mounted, focused])
  useLayoutEffect(() => {
    const root = rowWindow?.root
    if (!rowWindow || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    if (!root || !element.current) return
    // Decide before paint, against the restored position, instead of flashing placeholders.
    const offset =
      element.current.getBoundingClientRect().top -
      root.getBoundingClientRect().top +
      root.scrollTop
    const top = rowWindow.scrollTop.current
    setVisible(
      offset + element.current.offsetHeight >= top - overscan &&
        offset <= top + root.clientHeight + overscan,
    )
    return observeRow(element.current, root, setVisible)
  }, [rowWindow])
  useLayoutEffect(() => {
    if (rowWindow && mounted && element.current)
      rowWindow.measure(entryKey, element.current.offsetHeight)
  })
  const open = useCallback(() => actions.open(entryKey), [actions, entryKey])
  const split = useCallback(() => actions.split(entryKey), [actions, entryKey])
  const template = useCallback(
    (templateId: string) => actions.template(entryKey, templateId),
    [actions, entryKey],
  )
  const create = useCallback(() => actions.create(entryKey), [actions, entryKey])
  const filter = useCallback(() => actions.filter(entryKey), [actions, entryKey])
  const subagent = useCallback((id: string) => actions.subagent(entryKey, id), [actions, entryKey])
  return (
    <div
      ref={element}
      className="flex items-center"
      data-task-row-key={entryKey}
      tabIndex={!mounted && !disabled ? 0 : undefined}
      role={!mounted ? 'button' : undefined}
      aria-label={!mounted ? task.title : undefined}
      aria-disabled={!mounted && disabled ? true : undefined}
      style={mounted ? undefined : { height: rowWindow?.height(entryKey, estimate) ?? estimate }}
      onClickCapture={(event) => actions.clickCapture(entryKey, event)}
      onContextMenuCapture={() => actions.contextMenuCapture(entryKey)}
      onFocusCapture={(event) => {
        if (!mounted && event.target === event.currentTarget) {
          const from = event.relatedTarget
          focusHandoff.current =
            from instanceof Node &&
            event.currentTarget.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING
              ? 'last'
              : 'first'
        }
        setFocused(true)
      }}
      onBlurCapture={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setFocused(false)
      }}
    >
      {mounted && (
        <TaskContextMenu
          task={task}
          owner={owner}
          selectionMenu={selectionMenu}
          selected={selectedMain}
          busy={menuBusy}
          onOpen={open}
          onCreate={create}
          onFilter={filter}
          onSplit={canSplit ? split : undefined}
          onTemplate={canTemplate ? template : undefined}
          onDeselect={actions.deselect}
          onError={actions.error}
          onActiveChange={setActive}
        >
          <TaskRow
            task={task}
            subagents={subagents}
            needsInput={needsInput}
            terminals={terminals}
            selected={selected}
            selectedChildId={selectedChildId}
            multiSelected={multiSelected}
            owner={owner}
            editable={editable}
            disabled={disabled}
            onSelect={open}
            onOpenSubagent={subagent}
          />
        </TaskContextMenu>
      )}
    </div>
  )
}
/** A sidebar row re-renders only when its own task, owner facts or selection state change. */
export const TaskListRow = memo(TaskListRowView)
