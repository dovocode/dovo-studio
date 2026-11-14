import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import {
  agentHookSchema,
  agentHookEventChoices,
  decode,
  type AgentHook,
  type ResourceSettings,
  type SettingsScope,
} from '@dovo/protocol'
import { useApplicationState } from '../runtime/state/application-state'
import { SettingSource } from '../runtime/preferences/setting-source'
import { Switch } from '../ui/controls/switch'
import { Text } from '../ui/content/text'
import { useAction } from '../ui/controls/use-action'
import {
  SettingsAction as Action,
  SettingsChoice as Choice,
  SettingsField as Field,
} from '../screens/settings-controls'
import { SettingsSheet as Sheet, useSettingsTheme } from '../screens/settings-theme'

export function HookSettings({
  hooks,
  inherited,
  disabled,
  scope,
  origin,
  save,
}: {
  hooks: AgentHook[]
  inherited: readonly AgentHook[]
  disabled: boolean
  scope?: SettingsScope
  origin: (name: string) => Parameters<typeof SettingSource>[0]['source']
  save: (update: (value: ResourceSettings) => ResourceSettings) => Promise<void>
}) {
  const uiText = useInterfaceText()

  const { styles } = useSettingsTheme()
  const { act, busy, error, fieldError, validationAttempt } = useAction()
  const [editing, setEditing] = useApplicationState<{
    value: AgentHook
    previousName?: string
  } | null>(null)
  const blocked = disabled || busy
  const change = (update: (hooks: AgentHook[]) => AgentHook[]) =>
    save((value) => ({ ...value, hooks: update(value.hooks ?? []) }))
  const label = (hook: AgentHook) =>
    agentHookEventChoices.find((entry) => entry.id === hook.event)?.name
  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        <InterfaceText>{'Lifecycle hooks'}</InterfaceText>
      </Text>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'One configuration for every harness. Commands receive JSON event context on stdin. Tool hooks observe execution; permission-request hooks can deny approval. Failed after-turn checks allow two repair turns.'
          }
        </InterfaceText>
      </Text>
      <Action
        label={uiText('Add hook')}
        disabled={blocked}
        onPress={() =>
          setEditing({
            value: {
              name: '',
              enabled: true,
              event: 'after-turn',
              command: '',
              timeoutSeconds: 120,
            },
          })
        }
      />
      {!hooks.length && !inherited.length && (
        <Text style={styles.muted}>
          <InterfaceText>{'No hooks yet.'}</InterfaceText>
        </Text>
      )}
      {hooks.map((hook) => (
        <View key={hook.name} style={{ gap: 8 }}>
          <View style={styles.row}>
            <Text style={[styles.text, { flex: 1 }]}>{hook.name}</Text>
            <Switch
              accessibilityLabel={uiText('Enable hook {value0}', { value0: hook.name })}
              value={hook.enabled}
              disabled={blocked}
              onValueChange={(enabled) =>
                act(() =>
                  change((items) =>
                    items.map((item) => (item.name === hook.name ? { ...item, enabled } : item)),
                  ),
                )
              }
            />
          </View>
          <Text style={styles.muted}>
            {label(hook)}
            {hook.matcher ? ` · ${hook.matcher}` : ''} · {hook.command}
          </Text>
          {scope && <SettingSource label={hook.name} source={scope} overridden />}
          <View style={styles.row}>
            <Action
              secondary
              label={uiText('Edit hook {value0}', { value0: hook.name })}
              disabled={blocked}
              onPress={() => setEditing({ value: hook, previousName: hook.name })}
            />
            <Action
              secondary
              label={uiText('{value0} hook {value1}', {
                value0: inherited.some((item) => item.name === hook.name) ? 'Reset' : 'Remove',
                value1: hook.name,
              })}
              disabled={blocked}
              onPress={() =>
                act(() => change((items) => items.filter((item) => item.name !== hook.name)))
              }
            />
          </View>
        </View>
      ))}
      {inherited
        .filter((hook) => !hooks.some((item) => item.name === hook.name))
        .map((hook) => (
          <View key={`inherited:${hook.name}`} style={{ gap: 8 }}>
            <SettingSource label={hook.name} source={origin(hook.name)} overridden={false} />
            <Text style={styles.muted}>
              {label(hook)} · {hook.command}
            </Text>
            <Action
              secondary
              label={uiText('Override hook {value0}{value1}', {
                value0: hook.name,
                value1: hook.enabled ? '' : ' · Disabled',
              })}
              disabled={blocked}
              onPress={() => act(() => change((items) => [...items, hook]))}
            />
          </View>
        ))}
      {!!error && !editing && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {editing && (
        <Sheet
          title={
            editing.previousName
              ? uiText('Edit hook · {value0}', { value0: editing.previousName })
              : uiText('New hook')
          }
          busy={busy}
          validationAttempt={validationAttempt}
          onClose={() => setEditing(null)}
        >
          <Field
            label={uiText('Hook name')}
            value={editing.value.name}
            error={fieldError('name')}
            editable={!blocked}
            onChangeText={(name) => setEditing({ ...editing, value: { ...editing.value, name } })}
          />
          <Choice
            label={uiText('When')}
            value={editing.value.event}
            items={agentHookEventChoices}
            disabled={blocked}
            onChange={(value) => {
              const event = agentHookEventChoices.find((entry) => entry.id === value)
              if (event) setEditing({ ...editing, value: { ...editing.value, event: event.id } })
            }}
          />
          <Field
            label={uiText('Matcher (optional)')}
            value={editing.value.matcher ?? ''}
            error={fieldError('matcher')}
            editable={!blocked}
            onChangeText={(matcher) =>
              setEditing({ ...editing, value: { ...editing.value, matcher: matcher || undefined } })
            }
          />
          <Text style={styles.muted}>
            <InterfaceText>
              {
                'Regular expression matching tool category, tool name, subagent name or approval title. Empty or * matches all.'
              }
            </InterfaceText>
          </Text>
          <Field
            label={uiText('Hook command')}
            value={editing.value.command}
            error={fieldError('command')}
            editable={!blocked}
            multiline
            onChangeText={(command) =>
              setEditing({ ...editing, value: { ...editing.value, command } })
            }
          />
          <Field
            label={uiText('Timeout (seconds, 1–600)')}
            value={String(editing.value.timeoutSeconds)}
            error={fieldError('timeoutSeconds')}
            keyboardType="number-pad"
            editable={!blocked}
            onChangeText={(value) =>
              setEditing({ ...editing, value: { ...editing.value, timeoutSeconds: Number(value) } })
            }
          />
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Action
            label={uiText('Save hook')}
            disabled={blocked}
            onPress={() =>
              act(async () => {
                const value = decode(agentHookSchema, editing.value)
                if (
                  hooks.some(
                    (hook) => hook.name === value.name && hook.name !== editing.previousName,
                  )
                )
                  throw new Error('Hook names must be unique within this scope.')
                await change((items) => [
                  ...items.filter((item) => item.name !== editing.previousName),
                  value,
                ])
                setEditing(null)
              })
            }
          />
        </Sheet>
      )}
    </View>
  )
}
