import { createContext, useContext } from 'react'

export type TaskPanes = {
  expanded: boolean
  detailWidth: number
  selected?: { runtimeId: string; taskId: string }
}
export const TaskPanesContext = createContext<TaskPanes>({ expanded: false, detailWidth: 0 })
export const useTaskPanes = () => useContext(TaskPanesContext)
