import TasksScreen from './tasks'
import { WorkspaceOverview } from '../workspace/workspace-overview'
import { useCarMode, useMobilePreferences } from '../runtime/preferences/app-preferences'
export default function WorkbenchTasks() {
  const preferences = useMobilePreferences()
  const car = useCarMode()
  return !car && preferences.unifiedWorkspaceEnabled && preferences.unifiedWorkspaceActive ? (
    <WorkspaceOverview unified />
  ) : (
    <TasksScreen />
  )
}
