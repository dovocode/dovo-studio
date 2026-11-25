import { useEffect, useState } from 'react'
import { Linking, View } from 'react-native'
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
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../runtime/connection/provider'
import { Text } from '../ui/content/text'
import { SettingsAction as Action } from '../screens/settings-controls'
import { SettingsChoice as Choice } from '../screens/settings-controls'
import { SettingsField as Field } from '../screens/settings-controls'
import { useSettingsTheme as useTheme } from '../screens/settings-theme'

/**
 * OAuth sign-in for one remote MCP server on the connected computer. The token stays on that
 * computer. A phone cannot open the computer's loopback page, so the person pastes its address.
 */
export function McpOAuthSection({
  server,
  onChange,
  disabled,
}: {
  server: McpServer
  onChange: (server: McpServer) => void
  disabled: boolean
}) {
  const { call, connected, snapshot, overviews, activeId } = useRuntime()
  const { styles } = useTheme()
  const uiText = useInterfaceText()
  const supported = snapshot?.mcpOAuthSupported === true
  const computer = runtimeComputerName(
    overviews.find((entry) => entry.profile.id === activeId) ?? { snapshot },
  )
  const [status, setStatus] = useState<McpOAuthStatus>()
  const [flow, setFlow] = useState<McpOAuthFlow>()
  const [callback, setCallback] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const target = { name: server.name.trim(), url: server.url.trim(), scope: server.oauth?.scope }
  const ready = supported && connected && !!target.name && /^https?:\/\//.test(target.url)
  const refresh = async () => {
    if (!ready || !server.oauth) return setStatus(undefined)
    const result = await call(
      '/api/agents/mcp/oauth',
      { action: 'status', servers: [target] },
      mcpOAuthStatusListSchema,
    )
    setStatus(result.statuses[0])
  }
  useEffect(() => {
    void refresh().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, server.oauth !== undefined, target.name, target.url])
  useEffect(() => {
    if (!flow) return
    const timer = setInterval(() => {
      void call(
        '/api/agents/mcp/oauth',
        { action: 'flow', flowId: flow.flowId },
        mcpOAuthFlowStateSchema,
      )
        .then((state) => {
          if (state.state === 'pending') return
          setFlow(undefined)
          setCallback('')
          setMessage(
            state.state === 'connected'
              ? uiText('Signed in.')
              : (state.error ?? uiText('Sign-in {value0}.', { value0: state.state })),
          )
          void refresh()
        })
        .catch(() => {})
    }, 2000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow?.flowId])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const blocked = busy || disabled || !connected

  return (
    <View style={{ gap: 8 }}>
      <Choice
        label={uiText('Sign in with OAuth')}
        value={server.oauth ? 'true' : 'false'}
        disabled={disabled || (!supported && !server.oauth)}
        items={[
          { id: 'false', name: uiText('Off') },
          { id: 'true', name: uiText('On') },
        ]}
        onChange={(value) =>
          onChange({ ...server, oauth: value === 'true' ? { ...(server.oauth ?? {}) } : undefined })
        }
      />
      {!supported && (
        <Text style={styles.muted}>
          {uiText('Update the runtime on this computer to sign in to MCP servers with OAuth.')}
        </Text>
      )}
      {server.oauth && (
        <>
          <Field
            label={uiText('Scopes (optional)')}
            value={server.oauth.scope ?? ''}
            editable={!disabled}
            autoCapitalize="none"
            onChangeText={(scope) => onChange({ ...server, oauth: scope.trim() ? { scope } : {} })}
          />
          <Text style={styles.muted}>
            {uiText('Each computer signs in separately. Tokens stay on {value0}.', {
              value0: computer,
            })}
          </Text>
          <Text accessibilityLiveRegion="polite">
            {!ready
              ? uiText('Enter a name and server URL, and connect to the computer, to sign in.')
              : status?.state === 'connected'
                ? uiText('Signed in on {value0}.', { value0: computer })
                : status?.state === 'expired'
                  ? uiText('The sign-in on {value0} expired. Select Reconnect.', {
                      value0: computer,
                    })
                  : uiText('Not signed in on {value0}.', { value0: computer })}
          </Text>
          {flow ? (
            <>
              <Text>
                {uiText(
                  'Approve access in the browser, then copy the final address starting with {value0} and paste it here.',
                  { value0: flow.redirectUri },
                )}
              </Text>
              <Action
                secondary
                label={uiText('Open the sign-in page again')}
                onPress={() => void Linking.openURL(flow.authorizationUrl)}
              />
              <Field
                label={uiText('Browser address after sign-in')}
                value={callback}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setCallback}
              />
              <Action
                label={uiText('Finish sign-in')}
                disabled={busy || !callback.trim()}
                onPress={() =>
                  void run(async () => {
                    const state = await call(
                      '/api/agents/mcp/oauth',
                      { action: 'complete', flowId: flow.flowId, callbackUrl: callback },
                      mcpOAuthFlowStateSchema,
                    )
                    if (state.state === 'pending') return
                    setFlow(undefined)
                    setCallback('')
                    setMessage(
                      state.state === 'connected'
                        ? uiText('Signed in.')
                        : (state.error ?? uiText('Sign-in {value0}.', { value0: state.state })),
                    )
                    await refresh()
                  })
                }
              />
              <Action
                secondary
                label={uiText('Cancel sign-in')}
                onPress={() =>
                  void run(async () => {
                    await call(
                      '/api/agents/mcp/oauth',
                      { action: 'cancel', flowId: flow.flowId },
                      mcpOAuthFlowStateSchema,
                    )
                    setFlow(undefined)
                    setCallback('')
                  })
                }
              />
            </>
          ) : (
            ready && (
              <>
                <Action
                  secondary
                  label={
                    !status || status.state === 'disconnected'
                      ? uiText('Connect')
                      : uiText('Reconnect')
                  }
                  disabled={blocked}
                  onPress={() =>
                    void run(async () => {
                      const started = await call(
                        '/api/agents/mcp/oauth',
                        { action: 'connect', server: target },
                        mcpOAuthFlowSchema,
                      )
                      setFlow(started)
                      await Linking.openURL(started.authorizationUrl)
                    })
                  }
                />
                {status && status.state !== 'disconnected' && (
                  <Action
                    secondary
                    label={uiText('Disconnect')}
                    disabled={blocked}
                    onPress={() =>
                      void run(async () => {
                        const result = await call(
                          '/api/agents/mcp/oauth',
                          { action: 'disconnect', server: target },
                          mcpOAuthDisconnectSchema,
                        )
                        setMessage(
                          result.revoked
                            ? uiText('Signed out. The provider revoked the token.')
                            : uiText(
                                'Signed out on this computer. The provider did not confirm revocation.',
                              ),
                        )
                        await refresh()
                      })
                    }
                  />
                )}
              </>
            )
          )}
        </>
      )}
      {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
    </View>
  )
}
