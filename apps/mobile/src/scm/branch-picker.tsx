import { useState } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/text'
import { branchesSchema } from '@dovo/protocol'
import type { z } from 'zod'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { styles } from '../ui/theme'
export function BranchPicker({
  repositoryId,
  taskId,
  onChanged,
}: {
  repositoryId: string
  taskId?: string
  onChanged?: () => void
}) {
  const { call, connected } = useRuntime()
  const [open, setOpen] = useState(false),
    [data, setData] = useState<z.infer<typeof branchesSchema> | null>(null),
    [selected, setSelected] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const act = async (action?: 'switch' | 'create') => {
    setBusy(true)
    setError('')
    try {
      const result = await call(
        action ? '/api/scm/branch' : '/api/scm/branches',
        {
          repositoryId,
          taskId,
          ...(action
            ? {
                action,
                name: action === 'create' ? name.trim() : selected,
                revision: data?.revision,
              }
            : {}),
        },
        branchesSchema,
      )
      setData(result)
      setSelected('')
      setName('')
      if (action) onChanged?.()
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <Action
        secondary
        label="Branches"
        disabled={!connected || busy}
        onPress={() => {
          setOpen(!open)
          if (!open) void act()
        }}
      />
      {open && (
        <View style={[styles.card, { gap: 8 }]}>
          <Text style={styles.text}>Current: {data?.current ?? 'Loading…'}</Text>
          <Choice
            label="Target branch"
            value={selected}
            onChange={setSelected}
            items={[
              { id: '', name: 'Choose branch' },
              ...(data?.branches ?? [])
                .filter((b) => b.remote || !b.checkedOut)
                .map((b) => ({ id: b.ref, name: `${b.name}${b.remote ? ' · remote' : ''}` })),
            ]}
          />
          <Action
            label="Switch branch"
            disabled={!connected || busy || !selected}
            onPress={() => void act('switch')}
          />
          <Field label="New branch name" value={name} onChangeText={setName} />
          <Action
            label="Create branch"
            disabled={!connected || busy || !name.trim() || !data}
            onPress={() => void act('create')}
          />
          <Action
            secondary
            label="Refresh branches"
            disabled={!connected || busy}
            onPress={() => void act()}
          />
          <Text style={styles.muted}>
            Commit or stash changes first. Switching starts fresh agent sessions and pauses queued
            work.
          </Text>
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </View>
      )}
    </View>
  )
}
