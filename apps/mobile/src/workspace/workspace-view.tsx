import {
  createContext,
  useContext,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react'

type WorkspaceView = { search: string; kind: string; computer: string }
type SavedView = {
  view: WorkspaceView
  setView: Dispatch<SetStateAction<WorkspaceView>>
  scroll: RefObject<number>
}
const Context = createContext<{ unified: SavedView; terminal: SavedView } | null>(null)
function useSavedView(): SavedView {
  const [view, setView] = useState<WorkspaceView>({ search: '', kind: 'all', computer: 'all' })
  const scroll = useRef(0)
  return { view, setView, scroll }
}
export function WorkspaceViewProvider({ children }: { children: ReactNode }) {
  const unified = useSavedView()
  const terminal = useSavedView()
  return <Context.Provider value={{ unified, terminal }}>{children}</Context.Provider>
}
export function useWorkspaceView(unified: boolean) {
  const context = useContext(Context)
  if (!context) throw new Error('WorkspaceViewProvider required')
  return unified ? context.unified : context.terminal
}
