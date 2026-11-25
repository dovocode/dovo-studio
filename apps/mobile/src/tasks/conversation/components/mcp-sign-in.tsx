import { useEffect, useEffectEvent, useState } from 'react'
import { clientScopeKey } from '@dovo/client-runtime'
import { threadMcpOAuthWarningsSchema, type ThreadMcpOAuthWarning } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { McpOAuthSection } from '../../../resources/mcp-oauth'

export function ThreadMcpSignIn({ taskId, status }: { taskId: string; status: string }) {
  const { snapshot, connected, profile } = useRuntime()
  if (!snapshot?.threadMcpOAuthSupported || !profile?.connection) return null
  return (
    <WarningList
      key={JSON.stringify([profile.id, clientScopeKey(profile.connection), taskId])}
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
  const { call } = useRuntime()
  const [warnings, setWarnings] = useState<ThreadMcpOAuthWarning[]>([])
  const [revision, setRevision] = useState(0)
  const read = useEffectEvent(() =>
    call(
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
    <McpOAuthSection
      key={warning.revision}
      thread={{ taskId, warning }}
      disabled={!connected}
      onConnected={() => setRevision((value) => value + 1)}
    />
  ))
}
