import type { ReactNode } from 'react'
import type { RuntimeProfile } from '@dovo/protocol'
import { useState } from 'react'
import { View } from 'react-native'
import { RuntimeScope, useRuntime } from './provider'
import { Sheet } from '../ui/sheet'
import { Action } from '../ui/action'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'

/** Explicit execution targeting belongs to creation, not collection navigation. */
export function CreationTarget({
  title,
  onClose,
  children,
  alwaysChoose = false,
}: {
  title: string
  alwaysChoose?: boolean
  onClose: () => void
  children: (runtimeId: string) => ReactNode
}) {
  const { overviews } = useRuntime()
  const available = overviews.filter((entry) => entry.connected && entry.snapshot)
  const [target, setTarget] = useState<RuntimeProfile | null>(() =>
    !alwaysChoose && available.length === 1 ? available[0].profile : null,
  )
  const current = overviews.find((entry) => entry.profile.id === target?.id)?.profile
  if (
    target &&
    (!current ||
      current.connection.address !== target.connection.address ||
      current.connection.token !== target.connection.token)
  )
    return (
      <Sheet title={title} onClose={onClose}>
        <Text style={styles.muted}>
          This computer connection changed. Choose where to create this work again.
        </Text>
        <Action label="Choose another computer" onPress={() => setTarget(null)} />
      </Sheet>
    )
  return target ? (
    <RuntimeScope runtimeId={target.id}>{children(target.id)}</RuntimeScope>
  ) : (
    <Sheet title={title} onClose={onClose}>
      <Text style={styles.muted}>Choose where this work should run.</Text>
      {overviews.map((entry) => (
        <View key={entry.profile.id}>
          <Action
            label={entry.profile.name}
            secondary
            disabled={!entry.connected || !entry.snapshot}
            onPress={() => setTarget(entry.profile)}
          />
          {!entry.connected && <Text style={styles.muted}>Offline</Text>}
        </View>
      ))}
    </Sheet>
  )
}
