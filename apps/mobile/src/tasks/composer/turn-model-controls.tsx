import { View } from 'react-native'
import {
  agentTurnSettings,
  applyTurnSettings,
  modelCatalogChoices,
  type Agent,
  type TurnSettings,
} from '@dovo/protocol'
import { useState } from 'react'
import { useModelCatalog } from '../../agents/use-model-catalog'
import { Choice } from '../../ui/controls/choice'
import { Field } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function TurnModelControls({
  agent,
  value,
  onChange,
  disabled,
}: {
  agent: Agent
  value?: TurnSettings | null
  onChange: (value: TurnSettings | null) => void
  disabled?: boolean
}) {
  const { styles } = useTheme()
  const [custom, setCustom] = useState(false)
  const [customId, setCustomId] = useState('')
  const selected = applyTurnSettings(agent, value ?? undefined)
  const { catalog, error, loading, refresh, canDiscover } = useModelCatalog(selected)
  const models = modelCatalogChoices(catalog?.models ?? []).filter(
    (m) => !m.hidden || m.id === selected.model,
  )
  const model =
    catalog?.models.find((m) => m.id === selected.model) ??
    (!selected.model ? catalog?.models.find((m) => m.isDefault) : undefined)
  const efforts = model?.reasoning ?? catalog?.reasoning ?? []
  const update = (change: Partial<Pick<TurnSettings, 'model' | 'reasoning'>>) =>
    onChange({ ...agentTurnSettings(selected), ...change })
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.muted}>
        Only this turn. The active run and thread defaults stay unchanged.
      </Text>
      <Choice
        label="Turn model"
        value={value ? selected.model : '__inherit__'}
        disabled={disabled}
        items={[
          { id: '__inherit__', name: 'Thread defaults' },
          { id: '', name: 'Provider default' },
          ...models,
          ...(selected.model && !models.some((m) => m.id === selected.model)
            ? [{ id: selected.model, name: `${selected.model} (saved/custom)` }]
            : []),
          { id: '__custom__', name: 'Custom model…' },
        ]}
        onChange={(model) => {
          if (model === '__inherit__') {
            onChange(null)
            setCustom(false)
          } else if (model === '__custom__') {
            setCustomId(selected.model)
            setCustom(true)
          } else {
            setCustom(false)
            update({ model, reasoning: model === selected.model ? (selected.reasoning ?? '') : '' })
          }
        }}
      />
      {custom && (
        <View style={{ gap: 8 }}>
          <Field
            label="Turn custom model ID"
            editable={!disabled}
            value={customId}
            maxLength={500}
            onChangeText={setCustomId}
          />
          <Action
            label="Use model"
            disabled={disabled || !customId.trim()}
            onPress={() => {
              update({ model: customId.trim(), reasoning: '' })
              setCustom(false)
            }}
          />
        </View>
      )}
      <Choice
        label="Turn reasoning level"
        disabled={disabled}
        value={value ? (selected.reasoning ?? '') : '__inherit__'}
        items={[
          ...(!value ? [{ id: '__inherit__', name: 'Thread defaults' }] : []),
          { id: '', name: 'Provider default reasoning' },
          ...efforts,
          ...(selected.reasoning && !efforts.some((e) => e.id === selected.reasoning)
            ? [{ id: selected.reasoning, name: `${selected.reasoning} (saved)` }]
            : []),
        ]}
        onChange={(reasoning) =>
          reasoning === '__inherit__' ? onChange(null) : update({ reasoning })
        }
      />
      {!!value && (
        <Action
          secondary
          label="Use thread defaults"
          disabled={disabled}
          onPress={() => onChange(null)}
        />
      )}
      {loading && <Text style={styles.muted}>Loading models…</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        secondary
        label="Refresh models"
        disabled={loading || !canDiscover}
        onPress={refresh}
      />
    </View>
  )
}
