import { runtimeComputerName } from '@dovo/protocol'
import { useState } from 'react'
import { View } from 'react-native'
import { Schema } from 'effect'
import { usagePriceInput, type UsageRow, type UsageHistoryResult } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { SettingsAction as Action } from './settings-controls'
import { SettingsChoice as Choice } from './settings-controls'
import { SettingsField as Field } from './settings-controls'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
const fields = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
const labels = {
  input: 'Input',
  output: 'Output',
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
}
const ok = Schema.Struct({ ok: Schema.Boolean })
export function UsagePrices({
  rows,
  computer,
  histories,
  onSaved,
}: {
  rows: UsageRow[]
  computer: string
  histories: Record<string, UsageHistoryResult>
  onSaved: () => void
}) {
  const { styles } = useTheme()

  const [open, setOpen] = useState(false),
    [model, setModel] = useState('')
  const selected = rows.find((row) => row.key === model) ?? rows[0]
  if (!selected) return null
  const id = selected.key.split('\u0000')[1]
  return (
    <View style={{ gap: 12 }}>
      <Action
        label={open ? 'Hide custom prices' : 'Custom API-equivalent prices'}
        onPress={() => setOpen(!open)}
        secondary
      />
      {open && (
        <>
          <Text style={styles.muted}>
            USD per million tokens, saved on selected computers and applied to recorded usage. These
            estimates do not change subscription allowance.
          </Text>
          <Choice
            label="Model to price"
            value={encodeURIComponent(selected.key)}
            items={rows.map((row) => ({ id: encodeURIComponent(row.key), name: row.label }))}
            onChange={(value) =>
              setModel(rows.find((row) => encodeURIComponent(row.key) === value)?.key ?? '')
            }
          />
          <PriceForm
            key={`${id}:${computer}`}
            model={id}
            computer={computer}
            histories={histories}
            onSaved={onSaved}
          />
        </>
      )}
    </View>
  )
}
function PriceForm({
  model,
  computer,
  histories,
  onSaved,
}: {
  model: string
  computer: string
  histories: Record<string, UsageHistoryResult>
  onSaved: () => void
}) {
  const { styles } = useTheme()

  const { overviews, readRuntime } = useRuntime()
  const hosts = overviews.filter(
    (entry) => (computer === 'all' || entry.profile.id === computer) && entry.connected,
  )
  const saved = hosts.map((entry) => histories[entry.profile.id]?.overrides?.[model])
  const mixed = saved.some((price) => JSON.stringify(price) !== JSON.stringify(saved[0]))
  const initial = mixed ? undefined : saved[0]
  const [values, setValues] = useState({
    input: initial?.input.toString() ?? '',
    output: initial?.output.toString() ?? '',
    cacheRead: initial?.cacheRead.toString() ?? '',
    cacheWrite: initial?.cacheWrite.toString() ?? '',
  })
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const write = async (remove = false) => {
    const price = usagePriceInput(values)
    if (!remove && !price) {
      setMessage('Enter finite, non-negative input and output prices.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const results = await Promise.allSettled(
        hosts.map((entry) =>
          readRuntime(
            entry.profile,
            '/api/usage/prices/write',
            { model, ...(remove ? {} : { price }) },
            ok,
            'POST',
          ),
        ),
      )
      const failures = results.flatMap((result, index) =>
        result.status === 'rejected'
          ? [
              `${runtimeComputerName(hosts[index])}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
            ]
          : [],
      )
      setMessage(
        failures.length ? failures.join(' ') : remove ? 'Override removed.' : 'Prices saved.',
      )
      onSaved()
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.muted}>
        {hosts.length} connected computers will receive these prices. Offline computers are skipped.
      </Text>
      {mixed && <Text style={styles.muted}>Mixed prices across selected computers.</Text>}
      {fields.map((field) => (
        <Field
          key={field}
          label={labels[field]}
          keyboardType="decimal-pad"
          value={values[field]}
          placeholder={field.startsWith('cache') ? 'Input rate' : ''}
          onChangeText={(value) => setValues((previous) => ({ ...previous, [field]: value }))}
        />
      ))}
      <Action label="Save prices" onPress={() => void write()} disabled={busy || !hosts.length} />
      <Action
        label="Use published prices"
        onPress={() => void write(true)}
        disabled={busy || !hosts.length}
        secondary
      />
      {!!message && <Text style={styles.muted}>{message}</Text>}
    </View>
  )
}
