import { SettingsTheme } from '../../screens/settings-theme'
import { router } from 'expo-router'
import TasksScreen from '../../screens/tasks'
import { WorkbenchDetailRoute } from '../../shell/workbench'
import { TaskListViewProvider } from '../../tasks/list/task-list-view'
import { ScreenBackContext } from '../../ui/layout/screen-header'
export default function ArchivedTasksRoute() {
  return (
    <WorkbenchDetailRoute tab="settings" bottomInset>
      <ScreenBackContext.Provider value={() => router.dismissTo('/settings')}>
        <SettingsTheme>
          <TaskListViewProvider>
            <TasksScreen archived />
          </TaskListViewProvider>
        </SettingsTheme>
      </ScreenBackContext.Provider>
    </WorkbenchDetailRoute>
  )
}
