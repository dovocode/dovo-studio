import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useRef, useState } from 'react'
import { Platform, Pressable, View } from 'react-native'
import { runClientEffect } from '@dovo/client-runtime'
import {
  automationDryRunCounts,
  automationDryRunFieldUse,
  automationDryRunFields,
  automationDryRunOutcomeText,
  automationDryRunRequest,
  automationDryRunSchema,
  automationDryRunStatusText,
  dryRunScenario,
  dryRunScenarioFields,
  randomUUID,
  type Automation,
  type AutomationDryRun,
  type AutomationDryRunRequest,
  type DryRunScenario,
} from '@dovo/protocol'
import { useDryRunScenarios } from '@dovo/studio-core'
import { useRuntime } from '../runtime/connection/provider'
import { SettingsAction as Action } from '../screens/settings-controls'
import { SettingsChoice as Choice } from '../screens/settings-controls'
import { SettingsField as Field } from '../screens/settings-controls'
import { useAction } from '../ui/controls/use-action'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'

const monospace = Platform.OS === 'ios' ? 'Menlo' : 'monospace'

/** Test the editor's draft with sample data. The runtime runs no external step and saves nothing. */
export function DryRun({ flow, disabled }: { flow: Automation; disabled: boolean }) {
  const uiText = useInterfaceText()
  const { colors, styles } = useTheme()
  const { callEffect, profile, connected, read, snapshot } = useRuntime()
  const { act, error, busy } = useAction()
  const [open, setOpen] = useState(false)
  const [fields, setFields] = useState(() => automationDryRunFields(flow))
  const [result, setResult] = useState<AutomationDryRun>()
  const [shown, setShown] = useState<string[]>([])
  const [lastInput, setLastInput] = useState<AutomationDryRunRequest>()
  const [scenarioName, setScenarioName] = useState('')
  const [editing, setEditing] = useState<DryRunScenario>()
  const scenarioId = useRef<string | undefined>(undefined)
  const canSaveScenarios =
    !!snapshot?.automationDryRunScenariosSupported &&
    snapshot.workspace.automations.some((item) => item.id === flow.id)
  const scenarios = useDryRunScenarios(
    flow,
    read,
    profile?.connection,
    canSaveScenarios && connected && open,
  )
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    setResult(undefined)
    setLastInput(undefined)
    setScenarioName('')
    setEditing(undefined)
    scenarioId.current = undefined
  }, [profile?.id, flow.id])
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  const use = automationDryRunFieldUse(flow)
  const start = () =>
    act(async () => {
      const version = ++generation.current
      const body = automationDryRunRequest(flow, fields)
      const next = await runClientEffect(
        callEffect('/api/jobs/dry-run', body, automationDryRunSchema),
      )
      if (version === generation.current) {
        setResult(next)
        setLastInput(body)
        setShown([])
      }
    })
  if (!open)
    return (
      <Action
        secondary
        label={uiText('Dry run')}
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
    )
  const counts = result && automationDryRunCounts(result)
  const tone = { ran: colors.success, simulated: colors.accent, 'not-reached': colors.muted }
  return (
    <View testID="Dry run" style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={[styles.title, { marginTop: 8 }]}>
        <InterfaceText>{'Dry run'}</InterfaceText>
      </Text>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Test this automation with sample data. The trigger runs for real. Tasks, reviews and source checks are simulated. Nothing is started, saved, sent or counted as a run.'
          }
        </InterfaceText>
      </Text>
      {use.payload && (
        <Field
          label={uiText('Sample trigger data (JSON)')}
          value={fields.payload}
          editable={!busy}
          multiline
          autoCorrect={false}
          onChangeText={(payload) => setFields((value) => ({ ...value, payload }))}
          style={{ minHeight: 120, textAlignVertical: 'top', fontFamily: monospace }}
        />
      )}
      {use.scheduledFor && (
        <Field
          label={uiText('Sample due time')}
          value={fields.scheduledFor}
          editable={!busy}
          onChangeText={(scheduledFor) => setFields((value) => ({ ...value, scheduledFor }))}
          placeholder="2026-11-16T09:00:00Z"
        />
      )}
      {use.source && (
        <>
          <Field
            label={uiText('Sample source content')}
            value={fields.sourceText}
            editable={!busy}
            multiline
            onChangeText={(sourceText) => setFields((value) => ({ ...value, sourceText }))}
          />
          <Choice
            label={uiText('Source since the last successful run')}
            value={fields.sourceUnchanged ? 'unchanged' : 'changed'}
            items={[
              { id: 'changed', name: uiText('Changed') },
              { id: 'unchanged', name: uiText('Unchanged') },
            ]}
            disabled={busy}
            onChange={(choice) =>
              setFields((value) => ({ ...value, sourceUnchanged: choice === 'unchanged' }))
            }
          />
        </>
      )}
      {snapshot?.automationDryRunScenariosSupported && use.results.length > 0 && (
        <>
          <Field
            label={uiText('Sample step results (JSON)')}
            value={fields.stepResults}
            editable={!busy}
            multiline
            autoCorrect={false}
            maxLength={16384}
            onChangeText={(stepResults) => setFields((value) => ({ ...value, stepResults }))}
            style={{ minHeight: 100, textAlignVertical: 'top', fontFamily: monospace }}
          />
          <Text style={styles.muted}>
            {uiText('Use the step ID as the JSON key.')}{' '}
            {use.results.map(({ id, label }) => `${label} (${id})`).join(', ')}
          </Text>
        </>
      )}
      {use.stops.length > 0 && (
        <Choice
          label={uiText('Simulated outcome')}
          value={fields.stopAt || 'pass'}
          items={[
            { id: 'pass', name: uiText('Every step succeeds') },
            ...use.stops.map((step) => ({
              id: step.id,
              name:
                step.kind === 'review'
                  ? uiText('Reject at {value0}', { value0: step.label })
                  : uiText('Fail at {value0}', { value0: step.label }),
            })),
          ]}
          disabled={busy}
          onChange={(stopAt) =>
            setFields((value) => ({ ...value, stopAt: stopAt === 'pass' ? '' : stopAt }))
          }
        />
      )}
      {canSaveScenarios && (
        <View style={{ gap: 8 }}>
          {scenarios.cases.length > 0 && (
            <Action
              secondary
              disabled={scenarios.busy || busy || !connected}
              label={uiText('Run saved scenarios')}
              onPress={() => void scenarios.run()}
            />
          )}
          {scenarios.cases.map((scenario) => {
            const check = scenarios.checks?.find((item) => item.id === scenario.id)
            return (
              <View key={scenario.id} style={{ gap: 4 }}>
                <View style={styles.row}>
                  <Action
                    secondary
                    disabled={scenarios.busy || busy}
                    label={scenario.name}
                    onPress={() => {
                      setFields(dryRunScenarioFields(scenario))
                      setScenarioName(scenario.name)
                      setEditing(scenario)
                      setResult(undefined)
                      setLastInput(undefined)
                    }}
                  />
                  <Action
                    secondary
                    disabled={scenarios.busy || !connected}
                    label={uiText('Delete scenario')}
                    onPress={() => void scenarios.remove(scenario)}
                  />
                </View>
                {check && <Text>{uiText(check.issues.length ? 'Changed' : 'Passed')}</Text>}
                {check?.issues.map((issue) => (
                  <Text key={issue}>{issue}</Text>
                ))}
              </View>
            )
          })}
          {result && lastInput && (
            <>
              <Field
                label={uiText('Scenario name')}
                value={scenarioName}
                onChangeText={setScenarioName}
                maxLength={100}
              />
              <Action
                secondary
                disabled={scenarios.busy || busy || !connected || !scenarioName.trim()}
                label={uiText(editing ? 'Update scenario' : 'Save as scenario')}
                onPress={async () => {
                  if (
                    await scenarios.save(
                      dryRunScenario(
                        editing?.id ?? (scenarioId.current ??= randomUUID()),
                        scenarioName,
                        lastInput,
                        result,
                      ),
                      editing,
                    )
                  ) {
                    setScenarioName('')
                    setEditing(undefined)
                    scenarioId.current = undefined
                  }
                }}
              />
              {editing && (
                <Action
                  secondary
                  label={uiText('Cancel edit')}
                  onPress={() => {
                    setEditing(undefined)
                    setScenarioName('')
                  }}
                />
              )}
            </>
          )}
          {scenarios.error && <Text accessibilityRole="alert">{scenarios.error}</Text>}
        </View>
      )}
      <View style={[styles.row, { gap: 16 }]}>
        <Action
          label={uiText('Start dry run')}
          disabled={!connected || disabled || busy}
          onPress={start}
        />
        <Action
          secondary
          label={uiText('Reset sample data')}
          disabled={busy}
          onPress={() => setFields(automationDryRunFields(flow))}
        />
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {result && counts && (
        <View testID="Dry run result" style={{ gap: 10 }}>
          <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
            <Text style={[styles.text, { fontWeight: '600' }]}>
              {uiText(automationDryRunOutcomeText[result.outcome])}
            </Text>
            <Text style={styles.muted}>
              {uiText('{value0} ran · {value1} simulated · {value2} not reached', {
                value0: counts.ran,
                value1: counts.simulated,
                value2: counts.notReached,
              })}
            </Text>
          </View>
          {[...result.issues, ...result.warnings].map((message, index) => (
            <Text key={`${index}:${message}`} accessibilityRole="alert" style={styles.error}>
              {message}
            </Text>
          ))}
          {result.steps.map((step) => {
            const expanded = shown.includes(step.nodeId)
            const status = uiText(automationDryRunStatusText[step.status])
            return (
              <View key={step.nodeId} testID={`Dry run step ${step.label}`} style={{ gap: 4 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${step.label} · ${status}`}
                  accessibilityState={{ expanded, disabled: !step.inputs.length }}
                  accessibilityHint={
                    step.inputs.length
                      ? expanded
                        ? uiText('Hide inputs')
                        : uiText('Show inputs')
                      : undefined
                  }
                  disabled={!step.inputs.length}
                  onPress={() =>
                    setShown((ids) =>
                      expanded ? ids.filter((id) => id !== step.nodeId) : [...ids, step.nodeId],
                    )
                  }
                  style={[styles.row, { minHeight: 44, flexWrap: 'nowrap' }]}
                >
                  <Text style={[styles.text, { flex: 1, fontWeight: '600' }]} numberOfLines={2}>
                    {step.label}
                  </Text>
                  <Text style={[styles.muted, { color: tone[step.status] }]}>{status}</Text>
                </Pressable>
                {!!step.note && <Text style={styles.text}>{step.note}</Text>}
                {!!step.output && <Text style={styles.muted}>{step.output}</Text>}
                {expanded &&
                  step.inputs.map((item) => (
                    <View key={item.name} style={{ gap: 2 }}>
                      <Text style={[styles.muted, { fontWeight: '600' }]}>{item.name}</Text>
                      <Text selectable style={[styles.muted, { fontFamily: monospace }]}>
                        {item.value}
                      </Text>
                    </View>
                  ))}
              </View>
            )
          })}
          {result.unexercised.length > 0 && (
            <View style={{ gap: 4 }}>
              <Text style={[styles.text, { fontWeight: '600' }]}>
                <InterfaceText>{'Not tested by this dry run'}</InterfaceText>
              </Text>
              {result.unexercised.map((item, index) => (
                <Text key={`${index}:${item}`} style={styles.muted}>
                  {`• ${item}`}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  )
}
