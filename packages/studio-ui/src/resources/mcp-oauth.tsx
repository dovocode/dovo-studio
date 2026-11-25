import { useEffect, useState } from 'react'
import {
  mcpOAuthDisconnectSchema,
  mcpOAuthFlowSchema,
  mcpOAuthFlowStateSchema,
  mcpOAuthStatusListSchema,
  runtimeComputerName,
  type McpOAuthFlow,
  type McpOAuthStatus,
  type McpServer,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, FormField, Input } from '@dovo/studio-ui'
import { resourceError } from './error'

/**
 * OAuth sign-in for one remote MCP server on the connected computer. The token stays on that
 * computer; this panel only shows the connection state.
 */
export function McpOAuthPanel({
  draft,
  onChange,
  disabled,
}: {
  draft: McpServer
  onChange: (server: McpServer) => void
  disabled: boolean
}) {
  const { request, snapshot, connected, runtimes, activeRuntimeId } = useWorkspace()
  const supported = snapshot?.mcpOAuthSupported === true
  const computer = runtimeComputerName({
    profile: runtimes.find((entry) => entry.profile.id === activeRuntimeId)?.profile,
    snapshot,
  })
  const [status, setStatus] = useState<McpOAuthStatus | undefined>()
  const [flow, setFlow] = useState<McpOAuthFlow | undefined>()
  const [callback, setCallback] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const target = { name: draft.name.trim(), url: draft.url.trim(), scope: draft.oauth?.scope }
  const ready = supported && connected && !!target.name && /^https?:\/\//.test(target.url)

  const refresh = async () => {
    if (!ready || !draft.oauth) return setStatus(undefined)
    const result = await request(
      '/api/agents/mcp/oauth',
      { action: 'status', servers: [target] },
      mcpOAuthStatusListSchema,
    )
    setStatus(result.statuses[0])
  }
  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(resourceError(cause)))
    // The connection belongs to the saved name and exact URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, draft.oauth !== undefined, target.name, target.url])

  // The loopback page on the computer finishes the sign-in; poll until it reports a result.
  useEffect(() => {
    if (!flow) return
    const timer = setInterval(() => {
      void request(
        '/api/agents/mcp/oauth',
        { action: 'flow', flowId: flow.flowId },
        mcpOAuthFlowStateSchema,
      )
        .then((state) => {
          if (state.state === 'pending') return
          setFlow(undefined)
          setCallback('')
          if (state.state === 'connected') setNotice('Signed in.')
          else setError(state.error ?? `Sign-in ${state.state}.`)
          void refresh()
        })
        .catch(() => {})
    }, 1500)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow?.flowId])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (cause) {
      setError(resourceError(cause))
    } finally {
      setBusy(false)
    }
  }
  const connect = () =>
    run(async () => {
      const started = await request(
        '/api/agents/mcp/oauth',
        { action: 'connect', server: target },
        mcpOAuthFlowSchema,
      )
      setFlow(started)
      window.open(started.authorizationUrl, '_blank', 'noopener,noreferrer')
    })
  const complete = () =>
    run(async () => {
      if (!flow) return
      const state = await request(
        '/api/agents/mcp/oauth',
        { action: 'complete', flowId: flow.flowId, callbackUrl: callback },
        mcpOAuthFlowStateSchema,
      )
      if (state.state === 'pending') return
      setFlow(undefined)
      setCallback('')
      if (state.state === 'connected') setNotice('Signed in.')
      else setError(state.error ?? `Sign-in ${state.state}.`)
      await refresh()
    })
  const cancel = () =>
    run(async () => {
      if (flow)
        await request(
          '/api/agents/mcp/oauth',
          { action: 'cancel', flowId: flow.flowId },
          mcpOAuthFlowStateSchema,
        )
      setFlow(undefined)
      setCallback('')
    })
  const disconnect = () =>
    run(async () => {
      const result = await request(
        '/api/agents/mcp/oauth',
        { action: 'disconnect', server: target },
        mcpOAuthDisconnectSchema,
      )
      setNotice(
        result.revoked
          ? 'Signed out. The provider revoked the token.'
          : 'Signed out on this computer. The provider did not confirm revocation.',
      )
      await refresh()
    })

  return (
    <div className="grid gap-2 rounded-md border p-3 text-xs" data-testid="mcp-oauth">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={!!draft.oauth}
          disabled={disabled || (!supported && !draft.oauth)}
          onChange={(event) =>
            onChange({
              ...draft,
              oauth: event.target.checked ? { ...(draft.oauth ?? {}) } : undefined,
            })
          }
        />
        Sign in with OAuth
      </label>
      {!supported && (
        <p className="text-muted-foreground">
          Update the runtime on this computer to sign in to MCP servers with OAuth.
        </p>
      )}
      {draft.oauth && (
        <>
          <FormField label="Scopes (optional)">
            <Input
              placeholder="Use the server's advertised scopes"
              value={draft.oauth.scope ?? ''}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...draft,
                  oauth: event.target.value.trim() ? { scope: event.target.value } : {},
                })
              }
            />
          </FormField>
          <p className="text-muted-foreground">
            Each computer signs in separately. Tokens stay on {computer || 'the computer'} and are
            never copied to shared settings or other devices.
          </p>
          {ready ? (
            <p role="status">
              {status?.state === 'connected'
                ? `Signed in on ${computer}${status.refreshable ? '. Dovo refreshes the token automatically.' : status.expiresAt ? ` until ${new Date(status.expiresAt).toLocaleString()}.` : '.'}`
                : status?.state === 'expired'
                  ? `The sign-in on ${computer} expired. Select Reconnect.`
                  : `Not signed in on ${computer}.`}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {connected
                ? 'Enter a name and server URL to sign in.'
                : 'Connect to the computer to sign in.'}
            </p>
          )}
          {flow ? (
            <div className="grid gap-2">
              <p>
                Approve access in the browser tab that opened.{' '}
                <a
                  className="underline"
                  href={flow.authorizationUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open the sign-in page again
                </a>
                . When you use a browser on another device, the last page does not load. Copy its
                address, which starts with {flow.redirectUri}, and paste it here.
              </p>
              <Input
                aria-label="Browser address after sign-in"
                value={callback}
                disabled={busy}
                onChange={(event) => setCallback(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || !callback.trim()}
                  onClick={() => void complete()}
                >
                  Finish sign-in
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => void cancel()}>
                  Cancel sign-in
                </Button>
              </div>
            </div>
          ) : (
            ready && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || disabled}
                  onClick={() => void connect()}
                >
                  {status?.state === 'disconnected' || !status ? 'Connect' : 'Reconnect'}
                </Button>
                {status && status.state !== 'disconnected' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy || disabled}
                    onClick={() => void disconnect()}
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            )
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
