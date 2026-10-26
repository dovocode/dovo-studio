import { View } from 'react-native'
import { HarnessModelPicker } from '../../agents/harness-model-picker'
import {
  agentTurnSettings,
  harnessChoiceId,
  applyTurnSettings,
  modelCatalogChoices,
  type Agent,
  type TurnSettings,
  type Task,
} from '@dovo/protocol'
import { useState } from 'react'
import { useModelCatalog } from '../../agents/use-model-catalog'
import { Choice } from '../../ui/controls/choice'
import { Field } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { useRuntime } from '../../runtime/connection/provider'

export function TurnModelControls({
  agent,
  value,
  onChange,
  disabled,
  task,
}: {
  agent: Agent
  value?: TurnSettings | null
  onChange: (value: TurnSettings | null) => void
  disabled?: boolean
  task?: Task
}) {
  const { styles } = useTheme()
  const { snapshot } = useRuntime()
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
        {snapshot?.persistentTurnModelsSupported
          ? 'Model and reasoning stay selected for following turns. The active run stays unchanged.'
          : 'Only this turn. The active run and thread defaults stay unchanged.'}
      </Text>
      {task ? (
        <HarnessModelPicker
          modelsOnly
          task={task}
          agents={[]}
          choices={[{ id: harnessChoiceId(agent), name: agent.name, provider: agent.provider }]}
          selection={harnessChoiceId(agent)}
          agent={selected}
          disabled={!!disabled}
          onChange={(_selection, next) => {
            if (
              !disabled &&
              next.provider === agent.provider &&
              next.acpInstallationId === agent.acpInstallationId
            )
              onChange(agentTurnSettings(next))
          }}
        />
      ) : (
        <>
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
                update({
                  model,
                  reasoning: model === selected.model ? (selected.reasoning ?? '') : '',
                })
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
        </>
      )}
      <Choice
        row={!!task}
        label={task ? 'Reasoning level' : 'Turn reasoning level'}
        disabled={disabled}
        value={task || value ? (selected.reasoning ?? '') : '__inherit__'}
        items={[
          ...(!task && !value ? [{ id: '__inherit__', name: 'Thread defaults' }] : []),
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
      {!task && (
        <>
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
        </>
      )}
    </View>
  )
}
