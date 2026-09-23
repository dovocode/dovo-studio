import { useApplicationState } from '../runtime/application-state'
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  type ReactNode,
} from 'react'
type TaskListView = {
  search: string
  filter: string
  source: string
  sort: string
}
const Context = createContext<{
  view: TaskListView
  setView: Dispatch<SetStateAction<TaskListView>>
  scrollOffset: RefObject<number>
} | null>(null)

/** Aggregate list navigation survives the host-bound task screen and its editors. */
export function TaskListViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useApplicationState<TaskListView>({
    search: '',
    filter: 'active',
    source: 'all',
    sort: 'priority',
  })
  // Scroll events don't need to rerender the list or the surrounding native tabs.
  const scrollOffset = useRef(0)
  const value = useMemo(
    () => ({
      view,
      setView,
      scrollOffset,
    }),
    [view],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useTaskListView() {
  const state = useContext(Context)
  if (!state) throw new Error('TaskListViewProvider required')
  return state
}
