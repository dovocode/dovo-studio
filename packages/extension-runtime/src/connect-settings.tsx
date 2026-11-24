import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useAppPreferences } from '@dovo/studio-core'
import { useRef, useState } from 'react'
import { responses, ACCOUNT_DIRECTORY_URL } from '@dovo/protocol'
import { useAccount, useStudioHost, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { copyTextToClipboard } from '@dovo/studio-ui/clipboard'
import { RelaySettings } from './relay-settings'

export function ConnectSettings() {
  const host = useStudioHost()
  return (
    <>
      {host.accountStorage && host.openExternalLink && (
        <ConnectSettingsContent storage={host.accountStorage} open={host.openExternalLink} />
      )}
      <RelaySettings />
    </>
  )
}

function ConnectSettingsContent({
  storage,
  open,
}: {
  storage: NonNullable<ReturnType<typeof useStudioHost>['accountStorage']>
  open: (url: string) => Promise<void>
}) {
  const uiText = useInterfaceText()

  const services = useAppPreferences()
  const { client, directory, login, loaded, busy, error, deletionPending } = useAccount(
    storage,
    open,
    services,
  )
  const { snapshot, request, connected, activeRuntimeId, runtimeRegistry, refreshRuntime } =
    useWorkspace()
  const profile = runtimeRegistry.profiles.find((item) => item.id === activeRuntimeId)
  const [confirm, setConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')
  const [mcpConfirm, setMcpConfirm] = useState(false)
  const [copied, setCopied] = useState(false)
  const pending = useRef(false)
  if (!profile) return null
  const name = profile.name
  const internet = snapshot?.internet
  const mcp = internet?.remoteMcp
  const lanOnly = snapshot?.relaySettings?.connectionMode === 'lan'
  const setRemoteMcp = async (enabled: boolean) => {
    if (pending.current) return
    pending.current = true
    setSaving(true)
    setFailure('')
    try {
      await request(
        '/api/runtime/internet/remote-mcp',
        { enabled, consent: true },
        responses.internetStatus,
      )
      setMcpConfirm(false)
      setCopied(false)
      await refreshRuntime(profile)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : uiText('Could not update remote MCP'))
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  const enable = async () => {
    if (pending.current || !snapshot?.runtimeId) return
    pending.current = true
    setSaving(true)
    setFailure('')
    try {
      if (client.origin !== ACCOUNT_DIRECTORY_URL && !snapshot.internet?.origin)
        throw new Error('Update this computer before using a custom Connect URL')
      await client.enablePairedInternet(
        snapshot.runtimeId,
        (session) =>
          request(
            '/api/runtime/internet/setup',
            { session, consent: true, relay: 'dovo', origin: client.origin },
            responses.internetSetup,
          ),
        (id, grant) =>
          request('/api/runtime/internet/complete', { id, grant }, responses.internetStatus),
      )
      setConfirm(false)
      await refreshRuntime(profile)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not enable Dovo Connect')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  return (
    <section className="space-y-2 rounded-md border p-3" aria-label={`Dovo Connect for ${name}`}>
      <h2 className="text-sm font-medium">Dovo Connect + relay</h2>
      {snapshot?.internet?.origin && (
        <p className="break-all text-xs text-muted-foreground">
          Connect server: {snapshot.internet.origin}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {snapshot?.internet?.enabled
          ? snapshot.internet.connected
            ? 'Enabled · Online. Same-account devices can connect directly or through encrypted TURN relay.'
            : 'Enabled · Connecting to Dovo Connect…'
          : 'Enable account access and encrypted TURN fallback on this computer. LAN / VPN pairing stays available.'}
      </p>
      {snapshot?.internetSetupSupported === undefined ? (
        <p className="text-xs text-muted-foreground">
          Update Dovo on this computer to enable Connect from a paired device.
        </p>
      ) : (
        !snapshot.internet?.enabled &&
        snapshot.internetSetupSupported && (
          <>
            {login ? (
              <>
                <p role="status" className="text-sm">
                  Confirm code {login.code} in your browser.
                </p>
                <Button onClick={client.cancel}>Cancel sign-in</Button>
              </>
            ) : !directory ? (
              <Button disabled={!loaded || busy} onClick={() => void client.signIn()}>
                Sign in to enable Dovo Connect
              </Button>
            ) : confirm ? (
              <>
                <p role="alert" className="text-sm">
                  Enable Dovo Connect on {name} for {directory.user.name}? Devices signed in to this
                  account
                  {directory.user.organization ? ` (${directory.user.organization.name})` : ''} will
                  have access to files, agents and terminal commands on this computer. Encrypted
                  traffic may pass through Dovo TURN servers when a direct connection fails.
                  {directory.user.organization &&
                    ' Its organization relay settings will be applied automatically unless this computer has a manual TURN override.'}
                </p>
                <Button
                  disabled={!connected || busy || saving || deletionPending}
                  onClick={() => void enable()}
                >
                  {saving ? 'Enabling…' : 'Confirm Connect + relay'}
                </Button>
                <Button variant="ghost" disabled={saving} onClick={() => setConfirm(false)}>
                  {uiText('Cancel')}
                </Button>
              </>
            ) : (
              <Button
                disabled={!connected || busy || saving || deletionPending}
                onClick={() => setConfirm(true)}
              >
                Enable Dovo Connect + relay
              </Button>
            )}
          </>
        )
      )}
      {snapshot && (
        <div className="space-y-2 border-t pt-3">
          <h3 className="text-sm font-medium">{uiText('Remote MCP')}</h3>
          {!mcp ? (
            <p className="text-xs text-muted-foreground">
              {uiText('Update Dovo on this computer to configure remote MCP.')}
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {!internet?.enabled
                  ? uiText('Enable Dovo Connect first.')
                  : lanOnly
                    ? uiText('Remote MCP requires a connection mode that allows Dovo Connect.')
                    : mcp.enabled
                      ? uiText(
                          'Remote MCP is enabled on this computer. The Connect server must also support remote MCP.',
                        )
                      : uiText(
                          'Allow external AI apps to request access to this computer through Dovo Connect.',
                        )}
              </p>
              {!snapshot.internetSetupSupported ? (
                <p className="text-xs text-muted-foreground">
                  {uiText('Use a separately paired device to change remote MCP access.')}
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={
                      !connected || saving || (!mcp.enabled && (!internet?.enabled || lanOnly))
                    }
                    onClick={() => {
                      if (mcp.enabled || mcpConfirm) void setRemoteMcp(!mcp.enabled)
                      else setMcpConfirm(true)
                    }}
                  >
                    {mcp.enabled
                      ? uiText('Disable remote MCP')
                      : mcpConfirm
                        ? uiText('Confirm remote MCP access')
                        : uiText('Enable remote MCP')}
                  </Button>
                  {mcpConfirm && (
                    <Button variant="ghost" disabled={saving} onClick={() => setMcpConfirm(false)}>
                      {uiText('Cancel')}
                    </Button>
                  )}
                </div>
              )}
              {mcpConfirm && (
                <p role="status" className="text-xs text-muted-foreground">
                  {uiText(
                    'Each app signs in with OAuth. You choose whether it can read or also run agents on this computer.',
                  )}
                </p>
              )}
              {!!mcp.serverUrl && (
                <p className="break-all select-text font-mono text-xs">{mcp.serverUrl}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {!!mcp.serverUrl && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      setFailure('')
                      try {
                        await copyTextToClipboard(mcp.serverUrl!)
                        setCopied(true)
                      } catch {
                        setFailure(uiText('Could not copy the MCP server URL'))
                      }
                    }}
                  >
                    {copied ? uiText('Copied') : uiText('Copy MCP server URL')}
                  </Button>
                )}
                {!!mcp.managementUrl && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void open(mcp.managementUrl!).catch((error: unknown) =>
                        setFailure(
                          error instanceof Error ? error.message : uiText('Could not open link'),
                        ),
                      )
                    }
                  >
                    {uiText('Manage connected apps')}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {!!(failure || error || snapshot?.internet?.error) && (
        <p role="alert" className="text-xs text-destructive">
          {failure || error || snapshot?.internet?.error}
        </p>
      )}
    </section>
  )
}
