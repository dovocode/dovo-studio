import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import type { RuntimeProfile } from '@dovo/protocol'
import { runtimeComputerName } from '@dovo/protocol'
import { Text } from '../ui/content/text'
import { Switch } from '../ui/controls/switch'
import {
  SettingsAction as Action,
  SettingsChoice as Choice,
  SettingsField as Field,
} from './settings-controls'
import { useSettingsTheme } from './settings-theme'

/** UI values stay strings while editing, so incomplete port input remains a draft. */
export type DeviceHostDraft = {
  id: string
  name: string
  sshHost: string
  sshUser: string
  sshPort: string
  identityFile: string
  runtimeAddress: string
  pairedProfileId: string
  agentAccess: boolean
  hasToken: boolean
}

export function DeviceHostEditor({
  draft,
  profiles,
  busy,
  ready,
  checks,
  onChange,
  onTest,
  onSave,
  onCancel,
}: {
  draft: DeviceHostDraft
  profiles: RuntimeProfile[]
  busy: boolean
  ready: boolean
  checks: readonly { name: string; ok: boolean; message: string }[]
  onChange: (draft: DeviceHostDraft) => void
  onTest: () => void
  onSave: () => void
  onCancel: () => void
}) {
  const uiText = useInterfaceText()

  const { styles } = useSettingsTheme()
  const change = (patch: Partial<DeviceHostDraft>) => onChange({ ...draft, ...patch })
  return (
    <View style={{ gap: 20 }}>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'The current runtime connects over SSH to the destination computer. Install an updated Dovo runtime there and pair it with this phone first.'
          }
        </InterfaceText>
      </Text>
      <View style={styles.card}>
        <Field
          label={uiText('Device host name')}
          value={draft.name}
          editable={!busy}
          onChangeText={(name) => change({ name })}
          maxLength={80}
        />
        <Choice
          label={uiText('Paired destination computer')}
          value={draft.pairedProfileId}
          disabled={busy}
          items={[
            ...(draft.hasToken
              ? [{ id: '', name: uiText('Keep saved pairing') }]
              : [{ id: '', name: uiText('Choose a paired computer') }]),
            ...profiles.map((profile) => ({
              id: profile.id,
              name: runtimeComputerName({ profile }),
            })),
          ]}
          onChange={(pairedProfileId) => {
            const selected = profiles.find((profile) => profile.id === pairedProfileId)
            change({
              pairedProfileId,
              runtimeAddress: selected?.connection.address ?? draft.runtimeAddress,
            })
          }}
        />
        <Text style={styles.muted}>
          <InterfaceText>
            {'Uses the destination’s saved pairing securely. No pairing token is shown here.'}
          </InterfaceText>
        </Text>
        <Field
          label={uiText('Destination runtime address')}
          value={draft.runtimeAddress}
          editable={!busy}
          onChangeText={(runtimeAddress) => change({ runtimeAddress })}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'HTTP and HTTPS are supported. Use an address reachable from the current runtime. If the address differs from your saved profile, choose the pairing for that same destination.'
            }
          </InterfaceText>
        </Text>
      </View>
      <View style={styles.card}>
        <Field
          label={uiText('SSH host')}
          value={draft.sshHost}
          editable={!busy}
          onChangeText={(sshHost) => change({ sshHost })}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={uiText('mac-mini.local or VPN address')}
        />
        <Field
          label={uiText('SSH user')}
          value={draft.sshUser}
          editable={!busy}
          onChangeText={(sshUser) => change({ sshUser })}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Field
          label={uiText('SSH port')}
          value={draft.sshPort}
          editable={!busy}
          onChangeText={(sshPort) => change({ sshPort })}
          keyboardType="number-pad"
        />
        <Field
          label={uiText('SSH identity file path (optional)')}
          value={draft.identityFile}
          editable={!busy}
          onChangeText={(identityFile) => change({ identityFile })}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="/home/user/.ssh/id_ed25519"
        />
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'This key path belongs to the current runtime computer, not this phone or the destination. Leave it empty for the runtime’s SSH defaults. Key authentication only; never paste or upload a private key.'
            }
          </InterfaceText>
        </Text>
      </View>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={[styles.text, { flex: 1 }]}>
            <InterfaceText>{'Allow agent access'}</InterfaceText>
          </Text>
          <Switch
            accessibilityLabel={uiText('Allow agent access to device host')}
            value={draft.agentAccess}
            disabled={busy}
            onValueChange={(agentAccess) => change({ agentAccess })}
          />
        </View>
        <Text style={styles.muted}>
          <InterfaceText>
            {'Off by default. Enable to let agents discover and control devices on this host.'}
          </InterfaceText>
        </Text>
      </View>
      <Action
        label={busy ? uiText('Working…') : uiText('Test connection & readiness')}
        disabled={busy}
        onPress={onTest}
      />
      {!!checks.length && (
        <View style={styles.card}>
          {checks.map((check, index) => (
            <View key={`${check.name}:${index}`} style={{ gap: 4 }}>
              <Text style={styles.text}>
                {check.ok ? '✓' : '✕'} {check.name}
              </Text>
              <Text
                accessibilityRole={check.ok ? undefined : 'alert'}
                style={check.ok ? styles.muted : styles.error}
              >
                {check.message}
              </Text>
            </View>
          ))}
        </View>
      )}
      <Text style={styles.muted}>
        {ready
          ? uiText('Readiness checks passed. Ready to save.')
          : uiText('Test this draft successfully before saving. Changes require a new test.')}
      </Text>
      <Action label={uiText('Save device host')} disabled={busy || !ready} onPress={onSave} />
      <Action secondary label={uiText('Cancel editing')} disabled={busy} onPress={onCancel} />
    </View>
  )
}
