import { useLocalSearchParams } from 'expo-router'
import { WorkbenchDetailRoute } from '../../../../shell/workbench'
import { WorkspaceTerminalScreen } from '../../../../terminal/workspace-terminal-screen'
export default function Route() {
  const { runtimeId, terminalId } = useLocalSearchParams<{
    runtimeId: string
    terminalId: string
  }>()
  return (
    <WorkbenchDetailRoute tab="terminal" bottomInset>
      <WorkspaceTerminalScreen
        key={`${runtimeId}:${terminalId}`}
        runtimeId={runtimeId}
        terminalId={terminalId}
      />
    </WorkbenchDetailRoute>
  )
}
