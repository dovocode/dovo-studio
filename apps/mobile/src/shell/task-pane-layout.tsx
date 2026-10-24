import { useGlobalSearchParams } from 'expo-router'
import { View, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useMemo, type ReactNode } from 'react'
import { useRuntime } from '../runtime/connection/provider'
import { useCarMode } from '../runtime/preferences/app-preferences'
import { InlineScreenHeaderContext } from '../ui/layout/screen-header'
import { useTheme } from '../ui/theme'
import { TaskPanesContext } from './task-panes'
import { WorkbenchScene } from './workbench'

/** Keep the route navigator in one position so resizing never replaces an open composer. */
export function TaskPaneLayout({ children }: { children: ReactNode }) {
  const { width, fontScale } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const car = useCarMode()
  const { profiles } = useRuntime()
  const params = useGlobalSearchParams<{ runtimeId?: string; taskId?: string }>()
  const available = width - insets.left - insets.right
  const expanded = profiles.length > 0 && !car && available >= 760 * Math.max(1, fontScale)
  const sidebarWidth = Math.min(360, Math.max(280, available * 0.3))
  const detailWidth = expanded ? available - sidebarWidth - 1 : available
  const panes = useMemo(
    () => ({
      expanded,
      detailWidth,
      selected:
        params.runtimeId && params.taskId
          ? { runtimeId: params.runtimeId, taskId: params.taskId }
          : undefined,
    }),
    [expanded, detailWidth, params.runtimeId, params.taskId],
  )
  return (
    <TaskPanesContext.Provider value={panes}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.background }}>
        {expanded && (
          <SafeAreaView
            edges={['top']}
            testID="Thread sidebar"
            style={{ width: sidebarWidth, borderRightWidth: 1, borderRightColor: colors.border }}
          >
            <InlineScreenHeaderContext.Provider value>
              <WorkbenchScene tab="tasks" sidebar />
            </InlineScreenHeaderContext.Provider>
          </SafeAreaView>
        )}
        <View key="detail" testID="Thread detail pane" style={{ flex: 1, minWidth: 0 }}>
          {children}
        </View>
      </View>
    </TaskPanesContext.Provider>
  )
}
