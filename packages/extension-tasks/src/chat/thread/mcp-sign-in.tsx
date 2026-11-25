import { useEffect, useEffectEvent, useState } from 'react'
import { threadMcpOAuthWarningsSchema, type ThreadMcpOAuthWarning } from '@dovo/protocol'
import { clientScopeKey, useWorkspace } from '@dovo/studio-core'
import { McpOAuthPanel } from '@dovo/studio-ui/mcp-oauth'

export function ThreadMcpSignIn({ taskId, status }: { taskId: string; status: string }) {
  const { snapshot, connected, connection, activeRuntimeId } = useWorkspace()
  if (!snapshot?.threadMcpOAuthSupported || !connection) return null
  return (
    <WarningList
      key={JSON.stringify([activeRuntimeId, clientScopeKey(connection), taskId])}
      taskId={taskId}
      status={status}
      connected={connected}
    />
  )
}

function WarningList({
  taskId,
  status,
  connected,
}: {
  taskId: string
  status: string
  connected: boolean
}) {
  const { request } = useWorkspace()
  const [warnings, setWarnings] = useState<ThreadMcpOAuthWarning[]>([])
  const [revision, setRevision] = useState(0)
  const read = useEffectEvent(() =>
    request(
      '/api/agents/mcp/oauth',
      { action: 'thread-warnings', taskId },
      threadMcpOAuthWarningsSchema,
    ),
  )
  useEffect(() => {
    if (!connected) return
    let current = true
    void read().then(
      ({ warnings }) => {
        if (current) setWarnings(warnings)
      },
      () => {},
    )
    return () => {
      current = false
    }
  }, [connected, revision, status])
  return warnings.map((warning) => (
    <McpOAuthPanel
      key={warning.revision}
      thread={{ taskId, warning }}
      disabled={!connected}
      onConnected={() => setRevision((value) => value + 1)}
    />
  ))
}
