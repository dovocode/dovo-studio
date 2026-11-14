import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { sharedSettingsIssue } from '@dovo/protocol'
import { Disclosure } from '@dovo/studio-ui'
import { settingsChanges } from '@dovo/protocol'
import { secretReferenceIssue, responses } from '@dovo/protocol'
import { SecretEnvironmentEditor } from './secret-environment-editor'
import { selectPermissionPreset, permissionPolicyLabel } from '@dovo/protocol'
import { Schema } from 'effect'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import {
  agentConnectionValue,
  changeAgentConnection,
  changeAgentProvider,
  decode,
  decodeResult,
  formatAgentEnvironment,
  parseAgentEnvironment,
  providerDisplayName,
} from '@dovo/protocol'
import {
  agentSchema,
  providers,
  selectableAccessModes,
  supportsAccess,
  useWorkspace,
  useSettingsDraft,
  type Agent,
} from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  AgentAvatar,
  PermissionPolicyFields,
  permissionPolicyUIIssue,
  agentIconChoices,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  SettingsSaveBar,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@dovo/studio-ui'
import { ModelSettings } from './model-settings'
import { AcpRegistry } from './acp-registry'

export function AgentEditor({
  initial,
  creating,
  computerName,
  onClose,
  onSave,
  inline = false,
  onDirtyChange,
  fixedProvider = false,
  shared = false,
}: {
  initial: Agent
  creating: boolean
  computerName: string
  onClose: () => void
  onSave: (agent: Agent) => Promise<void>
  inline?: boolean
  onDirtyChange?: (dirty: boolean) => void
  fixedProvider?: boolean
  shared?: boolean
}) {
  const uiText = useInterfaceText()

  const { connected, snapshot, request } = useWorkspace()
  const pending = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const cloudHelpId = useId()
  const accessHelpId = useId()
  const [busy, setBusy] = useApplicationState(false)
  const [agent, setAgent] = useApplicationState(initial)
  const [error, setError] = useApplicationState('')
  const [step, setStep] = useApplicationState(creating ? 0 : 2)
  const [environment, setEnvironment] = useApplicationState(formatAgentEnvironment(initial.env))
  const dirty =
    JSON.stringify(agent) !== JSON.stringify(initial) ||
    environment !== formatAgentEnvironment(initial.env)
  const profileName = agent.name.trim() || initial.name
  const profileLabel =
    profileName === initial.name
      ? initial.name
      : `${initial.name} · Renames to ${profileName} on save`
  useSettingsDraft(dirty, busy)
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  const availableProviders = Object.keys(providers).map((id) =>
    decode(agentSchema.fields.provider, id),
  )
  const accessModes = selectableAccessModes(agent.permission, agent.provider)
  const discard = () => {
    setAgent(initial)
    setEnvironment(formatAgentEnvironment(initial.env))
    setError('')
  }
  return (
    <EditorShell
      inline={inline}
      busy={busy}
      creating={creating}
      computerName={computerName}
      onClose={onClose}
    >
      {creating && (
        <ol
          aria-label="Setup progress"
          className="mb-4 grid grid-cols-3 gap-1 rounded-lg border border-border/50 bg-background/50 p-1"
        >
          {['Provider', 'Profile', 'Model & behavior'].map((label, index) => (
            <li
              key={label}
              aria-current={step === index ? 'step' : undefined}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${step === index ? 'border-primary/30 bg-[var(--studio-selected-fill)] text-foreground [background-image:var(--studio-selected-gradient)] [box-shadow:var(--studio-glow)]' : 'border-transparent text-muted-foreground'}`}
            >
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${step >= index ? 'border-primary text-primary' : ''}`}
              >
                {step > index ? <Check className="size-3" /> : index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
      )}
      <form
        ref={form}
        className={inline ? 'contents' : 'flex min-h-0 flex-1 flex-col'}
        onSubmit={(event) => {
          event.preventDefault()
          if (creating && step < 2) {
            if (step === 1 && !agent.name.trim()) {
              setError('Enter an agent name.')
              return
            }
            setError('')
            setStep(step + 1)
            return
          }
          let env: Record<string, string>
          const secretIssue = secretReferenceIssue(agent.envSecrets)
          if (secretIssue) {
            setError(secretIssue)
            return
          }
          try {
            env = parseAgentEnvironment(environment)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
            return
          }
          const result = decodeResult(agentSchema, { ...agent, env, name: agent.name.trim() })
          if (!result.success) {
            setError('Enter an agent name.')
            return
          }
          const sharedIssue = shared && sharedSettingsIssue({ agents: [result.data] })
          if (sharedIssue) {
            setError(sharedIssue)
            return
          }
          if (
            pending.current ||
            !connected ||
            permissionPolicyUIIssue(agent, snapshot?.permissionPolicySupported === true)
          )
            return
          pending.current = true
          setBusy(true)
          setError('')
          void onSave(result.data)
            .then(() => {
              setAgent(result.data)
              setEnvironment(formatAgentEnvironment(result.data.env))
              onClose()
            })
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => {
              pending.current = false
              setBusy(false)
            })
        }}
      >
        <div
          data-agent-editor-scroll={!inline || undefined}
          className={inline ? undefined : '-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-5'}
        >
          <fieldset disabled={busy || !connected} className="min-w-0 space-y-5">
            <div className="space-y-5">
              {creating && step === 0 && (
                <section className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">Choose a provider</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Start with your provider’s normal installation and login.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {availableProviders
                      .filter((id) => id !== 'acp')
                      .map((id) => (
                        <Button
                          key={id}
                          type="button"
                          variant="outline"
                          className={`h-auto min-h-10 justify-start gap-2 whitespace-normal p-3 text-left ${agent.provider === id ? 'studio-nav-selected' : 'border-border/60 bg-background/60'}`}
                          aria-pressed={agent.provider === id}
                          onClick={() => setAgent(changeAgentProvider(agent, id))}
                        >
                          <AgentAvatar provider={id} className="size-5" />
                          <span>{providerDisplayName(id)}</span>
                          {agent.provider === id && <Check className="ml-auto size-3.5" />}
                        </Button>
                      ))}
                  </div>
                  <Disclosure title={<> More agents from the ACP registry </>}>
                    <div className="mt-3">
                      <AcpRegistry agent={changeAgentProvider(agent, 'acp')} onChange={setAgent} />
                    </div>
                  </Disclosure>
                </section>
              )}
              {(step === 1 || !creating) && (
                <section className="space-y-4">
                  {!creating && !inline && <h3 className="text-sm font-semibold">Profile</h3>}
                  <FormField layout="settings" label={uiText('Name')}>
                    <Input
                      aria-label={uiText('Name')}
                      required
                      value={agent.name}
                      placeholder="Give this profile a name"
                      onChange={(event) => setAgent({ ...agent, name: event.target.value })}
                    />
                  </FormField>
                  {!creating && !fixedProvider && (
                    <FormField layout="settings" label="Provider">
                      <Select
                        value={agent.provider}
                        onValueChange={(value) =>
                          setAgent(
                            changeAgentProvider(agent, decode(agentSchema.fields.provider, value)),
                          )
                        }
                      >
                        <SelectTrigger aria-label="Provider" className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {availableProviders.map((id) => (
                            <SelectItem key={id} value={id}>
                              {providerDisplayName(id)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                  <Disclosure open={creating ? true : undefined} title={<> Profile icon </>}>
                    <div
                      role="group"
                      aria-label="Agent icon"
                      className="mt-3 flex flex-wrap gap-1.5"
                    >
                      {Object.entries(agentIconChoices).map(([id, { label, icon: Icon }]) => (
                        <label key={id} title={label} className="cursor-pointer">
                          <input
                            type="radio"
                            name="agent-icon"
                            value={id}
                            aria-label={label}
                            checked={(agent.icon ?? 'bot') === id}
                            onChange={() =>
                              setAgent({
                                ...agent,
                                icon: decode(
                                  Schema.required(agentSchema.fields.icon.schema.schema),
                                  id,
                                ),
                              })
                            }
                            className="peer sr-only"
                          />
                          <span className="flex size-8 items-center justify-center rounded-md border border-transparent peer-checked:border-primary/40 peer-checked:bg-[var(--studio-selected-fill)] peer-checked:text-foreground peer-checked:[background-image:var(--studio-selected-gradient)] peer-checked:[box-shadow:var(--studio-glow)] peer-focus-visible:ring-2 peer-focus-visible:ring-ring hover:bg-muted">
                            <Icon size={15} />
                          </span>
                        </label>
                      ))}
                    </div>
                  </Disclosure>
                </section>
              )}
              {step === 2 && (
                <>
                  <section className="space-y-4 border-t pt-5">
                    {agent.provider === 'acp' && (
                      <AcpRegistry agent={agent} onChange={setAgent} showRegistry={false} />
                    )}
                    <ModelSettings agent={agent} onChange={setAgent} />
                    <div className="space-y-2">
                      <FormField layout="settings" label="Access mode">
                        <Select
                          value={
                            permissionPolicyLabel(agent) === 'Custom' ? 'custom' : agent.permission
                          }
                          onValueChange={(value) => {
                            // Radix's form bridge emits an empty value while switching to Custom.
                            if (!value || value === 'custom') return
                            setAgent(
                              selectPermissionPreset(
                                agent,
                                decode(agentSchema.fields.permission, value),
                              ),
                            )
                          }}
                        >
                          <SelectTrigger
                            aria-label="Access mode"
                            aria-describedby={accessHelpId}
                            className="h-9 text-xs"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {permissionPolicyLabel(agent) === 'Custom' && (
                              <SelectItem value="custom" disabled>
                                Custom
                              </SelectItem>
                            )}
                            {accessModes.map((mode) => (
                              <SelectItem
                                key={mode.id}
                                value={mode.id}
                                disabled={!supportsAccess(agent.provider, mode.id)}
                              >
                                {mode.name}
                                {supportsAccess(agent.provider, mode.id) ? '' : ' · Not supported'}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormField>
                      <p
                        id={accessHelpId}
                        className="text-xs font-normal leading-relaxed text-muted-foreground"
                      >
                        {accessModes.find((mode) => mode.id === agent.permission)?.description}
                      </p>
                    </div>
                    {(agent.provider === 'claude' || agent.provider === 'codex') && (
                      <div className="space-y-2">
                        <FormField layout="settings" label="Cloud integrations">
                          <Select
                            value={
                              agent.cloudIntegrations === undefined
                                ? 'default'
                                : String(agent.cloudIntegrations)
                            }
                            onValueChange={(value) => {
                              if (!value) return
                              setAgent({
                                ...agent,
                                cloudIntegrations:
                                  value === 'default' ? undefined : value === 'true',
                              })
                            }}
                          >
                            <SelectTrigger
                              aria-label="Cloud integrations"
                              aria-describedby={cloudHelpId}
                              className="h-9 text-xs"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">Provider default</SelectItem>
                              <SelectItem value="true">{uiText('Enabled')}</SelectItem>
                              <SelectItem value="false">{uiText('Disabled')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormField>
                        <p
                          id={cloudHelpId}
                          className="text-xs font-normal leading-relaxed text-muted-foreground"
                        >
                          Use apps already connected to your{' '}
                          {agent.provider === 'claude' ? 'Claude' : 'ChatGPT'} account, such as
                          Google Drive or Slack. Requires account sign-in on the computer running
                          the thread. Provider restrictions and tool approvals still apply.
                        </p>
                      </div>
                    )}
                    <PermissionPolicyFields
                      value={agent}
                      layout="settings"
                      supported={snapshot?.permissionPolicySupported === true}
                      disabled={busy || !connected}
                      onChange={(policy) => setAgent({ ...agent, ...policy })}
                    />
                    {!supportsAccess(agent.provider, agent.permission) && (
                      <p role="alert" className="text-xs text-destructive">
                        Choose an access mode supported by this provider.
                      </p>
                    )}
                    <div className="studio-agent-instructions">
                      <FormField layout="settings" label="Instructions">
                        <Textarea
                          aria-label="Instructions"
                          rows={6}
                          className="min-h-36 font-normal leading-relaxed text-foreground max-md:text-base!"
                          value={agent.instructions}
                          placeholder="Optional. Added to every thread that uses this profile…"
                          onChange={(event) =>
                            setAgent({ ...agent, instructions: event.target.value })
                          }
                        />
                      </FormField>
                    </div>
                  </section>
                  <Disclosure title={<> Connection & account </>}>
                    <div className="mt-4 space-y-4">
                      {shared && (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          Shared profiles use each computer’s installation and login. Use
                          environment-variable names for credentials. Save local paths and literal
                          values at Computer or Project on computer.
                        </p>
                      )}
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Optional. Leave blank to use the provider installed and signed in on the
                        computer that runs the thread. Paths refer to that computer.
                      </p>
                      {agent.provider === 'hermes' && (
                        <p className="text-xs text-muted-foreground">
                          Uses Hermes installed on this computer, including its memory and skills.
                          Configure its provider with <code>hermes model</code>.
                        </p>
                      )}
                      {agent.provider === 'cursor' && (
                        <p className="text-xs text-muted-foreground">
                          Use CURSOR_API_KEY on this computer or the Cursor SDK browser login.
                          Cursor desktop login is separate.
                        </p>
                      )}
                      {agent.provider !== 'cursor' && (
                        <FormField
                          layout="settings"
                          label={
                            agent.provider === 'opencode' ? 'Server URL' : 'Connection / executable'
                          }
                        >
                          <Input
                            aria-label={
                              agent.provider === 'opencode'
                                ? 'Server URL'
                                : 'Connection / executable'
                            }
                            value={agentConnectionValue(agent)}
                            placeholder={
                              agent.provider === 'opencode'
                                ? 'Automatic local OpenCode server'
                                : 'Use provider default'
                            }
                            onChange={(event) =>
                              setAgent(changeAgentConnection(agent, event.target.value))
                            }
                          />
                        </FormField>
                      )}
                      {agent.provider === 'opencode' && !agent.endpoint.trim() && (
                        <FormField layout="settings" label="OpenCode executable path (optional)">
                          <Input
                            value={agent.executablePath ?? ''}
                            placeholder="opencode"
                            onChange={(event) =>
                              setAgent({ ...agent, executablePath: event.target.value })
                            }
                          />
                        </FormField>
                      )}
                      {(['codex', 'claude', 'vibe', 'hermes', 'copilot'] as const).some(
                        (provider) => provider === agent.provider,
                      ) && (
                        <FormField
                          layout="settings"
                          label={`Config directory (${
                            agent.provider === 'vibe'
                              ? 'VIBE_HOME'
                              : agent.provider === 'hermes'
                                ? 'HERMES_HOME'
                                : agent.provider === 'copilot'
                                  ? 'COPILOT_HOME'
                                  : agent.provider === 'codex'
                                    ? 'CODEX_HOME'
                                    : 'CLAUDE_CONFIG_DIR'
                          })`}
                        >
                          <Input
                            value={agent.configDirectory ?? ''}
                            placeholder="Provider default"
                            onChange={(event) =>
                              setAgent({ ...agent, configDirectory: event.target.value })
                            }
                          />
                        </FormField>
                      )}
                      {agent.provider !== 'cursor' &&
                        (agent.provider !== 'opencode' || !agent.endpoint.trim()) && (
                          <FormField layout="settings" label="Executable arguments (one per line)">
                            <Textarea
                              value={(agent.args ?? []).join('\n')}
                              onChange={(event) =>
                                setAgent({
                                  ...agent,
                                  args: event.target.value
                                    .split('\n')
                                    .filter((line) => line.trim()),
                                })
                              }
                            />
                          </FormField>
                        )}
                      <FormField layout="settings" label="Environment variables">
                        <Textarea
                          aria-label="Environment variables"
                          value={environment}
                          onChange={(event) => setEnvironment(event.target.value)}
                          placeholder="EXAMPLE=value"
                        />
                        <p className="font-normal leading-relaxed">
                          One NAME=value per line. Stored as readable settings, so keep secrets in
                          the computer’s own environment.
                        </p>
                      </FormField>
                      {snapshot?.secretReferencesSupported && (
                        <SecretEnvironmentEditor
                          value={agent.envSecrets}
                          onChange={(envSecrets) => setAgent({ ...agent, envSecrets })}
                          disabled={busy || !connected}
                          onRefresh={async () => {
                            await request('/api/agents/secrets/refresh', {}, responses.ok)
                          }}
                        />
                      )}
                    </div>
                  </Disclosure>
                </>
              )}
            </div>
          </fieldset>
        </div>
        <div
          data-settings-sticky-actions={
            inline && (creating || dirty || busy || error) ? '' : undefined
          }
          className={`min-w-0 shrink-0 pt-3 ${inline ? 'mt-5' : 'studio-scroll-gutter-match -mx-1 -mb-1 px-1 pb-1'} ${inline && (creating || dirty || busy || error) ? 'sticky bottom-[calc(-1*var(--studio-settings-scroll-padding,0px))] z-10 bg-background pb-[var(--studio-settings-scroll-padding,0px)]' : ''}`}
        >
          <fieldset
            disabled={busy || !connected}
            className="min-w-0 space-y-3 [&>.studio-settings-savebar]:static [&>.studio-settings-savebar]:backdrop-blur-none"
          >
            {error && (
              <p role="alert" className="break-words text-xs text-destructive">
                {error}
              </p>
            )}
            {!creating ? (
              <SettingsSaveBar
                surface={inline ? 'page' : 'embedded'}
                changes={settingsChanges(
                  { ...initial, env: undefined, environment: formatAgentEnvironment(initial.env) },
                  { ...agent, env: undefined, environment },
                )}
                dirty={dirty}
                saving={busy}
                disabled={
                  !connected ||
                  !!permissionPolicyUIIssue(agent, snapshot?.permissionPolicySupported === true) ||
                  !supportsAccess(agent.provider, agent.permission)
                }
                description={`${profileLabel} · ${computerName}. Applies to new turns.`}
                onDiscard={discard}
                onSave={() => form.current?.requestSubmit()}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
                <div className="flex gap-2">
                  {step > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setError('')
                        setStep(step - 1)
                      }}
                    >
                      {uiText('Back')}
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={
                      busy ||
                      !connected ||
                      (step === 2 &&
                        (!!permissionPolicyUIIssue(
                          agent,
                          snapshot?.permissionPolicySupported === true,
                        ) ||
                          !supportsAccess(agent.provider, agent.permission)))
                    }
                  >
                    {busy ? 'Saving…' : step < 2 ? 'Next' : 'Add agent profile'}
                  </Button>
                </div>
              </div>
            )}
          </fieldset>
        </div>
      </form>
    </EditorShell>
  )
}

function EditorShell({
  inline,
  busy,
  creating,
  computerName,
  onClose,
  children,
}: {
  inline: boolean
  busy: boolean
  creating: boolean
  computerName: string
  onClose: () => void
  children: ReactNode
}) {
  // Let the existing profile pane bound inline sticky actions, including on narrow screens.
  if (inline) return <div className="contents">{children}</div>
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="studio-agent-editor flex max-h-[90vh] max-w-2xl flex-col overflow-hidden p-6">
        <DialogHeader>
          <DialogTitle>{creating ? 'Add agent profile' : 'Edit agent profile'}</DialogTitle>
          <DialogDescription>
            Stored at {computerName} and inherited by more specific settings levels.{' '}
            {creating ? 'Add the profile to save these settings.' : 'Save changes to apply edits.'}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
