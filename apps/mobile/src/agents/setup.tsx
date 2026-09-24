import { harnessNames } from '../tasks/harness-choices'
import { useEffect } from 'react'
import { View } from 'react-native'
import { runClientEffect } from '@dovo/client-runtime'
import {
  decode,
  defaultTaskHarness,
  providerSchema,
  resolveTitleHarness,
  runtimeSetupSchema,
  taskHarnessSchema,
  titleSettingsForHarness,
  type Agent,
  type RuntimeSetup,
} from '@dovo/protocol'
import { useApplicationState } from '../runtime/application-state'
import { mobileWorkflow } from '../runtime/native-effect'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { Sheet } from '../ui/sheet'
import { Text } from '../ui/text'
import { colors, styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { ModelSettings } from './model-settings'
import { AcpRegistry } from './acp-registry'

export function Setup() {
  const { snapshot, connected } = useRuntime()
  const [open, setOpen] = useApplicationState(false)
  const defaults = snapshot?.defaults
  return (
    <View style={styles.card}>
      <Text style={styles.text}>
        {defaults?.configured ? 'Your defaults' : 'Set up your workspace'}
      </Text>
      <Text style={styles.muted}>
        {defaults?.configured
          ? `${harnessNames[defaults.harness.provider]} · ${defaults.harness.model || 'Provider default model'}`
          : 'Choose your everyday model and a separate model for titles and dictation.'}
      </Text>
      <Text style={styles.muted}>
        Shared with devices paired to this computer. Existing tasks keep their settings.
      </Text>
      <Action
        label={defaults?.configured ? 'Edit defaults' : 'Set up defaults'}
        disabled={!connected}
        onPress={() => setOpen(true)}
      />
      {open && (
        <Sheet title="Workspace setup" onClose={() => setOpen(false)}>
          <SetupForm onClose={() => setOpen(false)} />
        </Sheet>
      )}
    </View>
  )
}
function SetupForm({ onClose }: { onClose: () => void }) {
  const { snapshot, connected, callEffect } = useRuntime()
  const { act, busy, error } = useAction()
  const [settings, setSettings] = useApplicationState<RuntimeSetup | null>(null)
  const [step, setStep] = useApplicationState(0)
  const [loadError, setLoadError] = useApplicationState('')
  const [retry, setRetry] = useApplicationState(0)
  const [connection, setConnection] = useApplicationState(false)
  useEffect(() => {
    let active = true
    setSettings(null)
    setLoadError('')
    if (!connected) return
    void runClientEffect(
      mobileWorkflow(function* () {
        const value = yield* callEffect('/api/agents/setup/read', {}, runtimeSetupSchema)
        if (active) setSettings(value)
      }),
    ).catch((error) => {
      if (active) setLoadError(String(error))
    })
    return () => {
      active = false
    }
  }, [callEffect, connected, retry])
  if (!settings)
    return (
      <View style={styles.content}>
        <Text style={styles.muted}>
          {loadError ||
            (connected ? 'Loading your settings…' : 'Connect this computer to set up defaults.')}
        </Text>
        {loadError && <Action label="Try again" onPress={() => setRetry((n) => n + 1)} />}
      </View>
    )
  const titleHarness = resolveTitleHarness(
    settings.titles,
    snapshot?.workspace.agents ?? [],
    settings.defaults.configured ? settings.defaults.harness : undefined,
  )
  const agent: Agent =
    step === 0
      ? { ...settings.defaults.harness, id: 'default', name: 'Default agent' }
      : {
          ...(titleHarness ?? defaultTaskHarness('codex')),
          id: 'titles',
          name: 'Titles & dictation',
          model: settings.titles.model,
          reasoning: settings.titles.reasoning,
        }
  const change = (next: Agent) =>
    setSettings(
      step === 0
        ? {
            ...settings,
            defaults: { ...settings.defaults, harness: decode(taskHarnessSchema, next) },
          }
        : { ...settings, titles: titleSettingsForHarness(next) },
    )
  return (
    <View style={styles.content}>
      <Text style={[styles.muted, { color: colors.accent }]}>Step {step + 1} of 2</Text>
      <Text style={styles.title}>{step === 0 ? 'Your everyday agent' : 'Titles & dictation'}</Text>
      <Text style={styles.muted}>
        {step === 0
          ? 'New tasks start with this provider and model. You can change them before sending the first message.'
          : 'Choose a separate model for short titles and dictation cleanup. A small, fast model is usually enough. This stays independent of your everyday model.'}
      </Text>
      <Choice
        label="Provider"
        value={agent.provider}
        disabled={busy || !connected}
        items={providerSchema.literals.map((provider) => ({
          id: provider,
          name: harnessNames[provider],
        }))}
        onChange={(provider) =>
          change({
            ...defaultTaskHarness(decode(providerSchema, provider)),
            id: agent.id,
            name: agent.name,
          })
        }
      />
      {agent.provider === 'acp' && (
        <AcpRegistry key={`${step}:${agent.provider}`} agent={agent} onChange={change} />
      )}
      <ModelSettings
        key={`${step}:${agent.provider}`}
        agent={agent}
        onChange={change}
        disabled={busy || !connected}
        serviceTier={step === 0}
      />
      <Action
        label={connection ? 'Hide connection options' : 'Connection options'}
        secondary
        onPress={() => setConnection(!connection)}
        disabled={busy}
      />
      {connection && (
        <>
          <Field
            label="Executable or server URL"
            value={agent.endpoint}
            placeholder="Use runtime default"
            editable={!busy && connected}
            onChangeText={(endpoint) => change({ ...agent, endpoint })}
          />
          {agent.provider === 'acp' && (
            <Field
              label="Arguments (one per line)"
              value={(agent.args ?? []).join('\n')}
              multiline
              editable={!busy && connected}
              onChangeText={(args) => change({ ...agent, args: args.split('\n').filter(Boolean) })}
            />
          )}
        </>
      )}
      {step === 1 && (
        <View style={styles.card}>
          <Text style={styles.muted}>
            New tasks: {harnessNames[settings.defaults.harness.provider]} ·{' '}
            {settings.defaults.harness.model || 'Provider default model'}
          </Text>
          <Text style={styles.muted}>
            Titles & dictation: {harnessNames[agent.provider]} ·{' '}
            {agent.model || 'Provider default model'}
          </Text>
        </View>
      )}
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Action
          label={step ? 'Previous step' : 'Cancel'}
          secondary
          disabled={busy}
          onPress={() => (step ? setStep(0) : onClose())}
        />
        <Action
          label={busy ? 'Saving…' : step ? 'Save setup' : 'Next: title model'}
          disabled={busy || !connected}
          onPress={() => {
            if (!step) {
              setStep(1)
              return
            }
            act(() =>
              mobileWorkflow(function* () {
                yield* callEffect(
                  '/api/agents/setup/save',
                  {
                    ...settings,
                    titles:
                      settings.titles.harness || settings.titles.agentId
                        ? settings.titles
                        : titleSettingsForHarness(agent),
                  },
                  runtimeSetupSchema,
                )
                onClose()
              }),
            )
          }}
        />
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
