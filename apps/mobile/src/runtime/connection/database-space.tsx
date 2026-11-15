import { useEffect, useRef, useState } from 'react'
import { Alert, View } from 'react-native'
import { Schema } from 'effect'
import { databaseSpaceSchema, databaseSpaceRecoverySchema } from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from './provider'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'

const mb = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`
export function DatabaseSpace() {
  const { call, connected } = useRuntime()
  const { styles } = useTheme()
  const uiText = useInterfaceText()
  const [space, setSpace] = useState<Schema.Schema.Type<typeof databaseSpaceSchema>>()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const recovering = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    let active = true
    if (connected)
      void call('/api/runtime/storage', {}, databaseSpaceSchema).then(
        (result) => {
          if (active) setSpace(result)
        },
        (cause) => {
          if (active) setError(String(cause))
        },
      )
    return () => {
      active = false
    }
  }, [connected, call])
  const recover = async () => {
    // A system alert can outlive this computer's settings screen.
    if (!mounted.current || recovering.current) return
    recovering.current = true
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const result = await call(
        '/api/runtime/storage/recover',
        { confirm: true },
        databaseSpaceRecoverySchema,
      )
      if (!mounted.current) return
      setSpace(result.after)
      setStatus(`${uiText('Space recovery finished. Verified backup')}: ${result.backup.path}`)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      recovering.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <View accessibilityLabel={uiText('Database space')} style={{ gap: 8 }}>
      <Text style={styles.title}>{uiText('Database space')}</Text>
      {space && (
        <>
          <Text>
            {uiText('Database')}: {mb(space.fileBytes)} · {uiText('WAL')}: {mb(space.walBytes)}
          </Text>
          <Text>
            {uiText('Reclaimable pages')}: {mb(space.reclaimableBytes)} · {uiText('Disk free')}:{' '}
            {space.freeBytes === null ? uiText('Unavailable') : mb(space.freeBytes)}
          </Text>
        </>
      )}
      <Text style={styles.muted}>
        {uiText(
          'Recover unused pages without deleting history, settings or pairings. A verified backup needs extra disk space. Finish active work first. Requests pause briefly during recovery.',
        )}
      </Text>
      <Action
        secondary
        disabled={!connected || busy || !space?.persistent || !space.reclaimableBytes}
        label={uiText(busy ? 'Recovering space…' : 'Recover database space')}
        onPress={() =>
          Alert.alert(
            uiText('Recover database space'),
            uiText(
              'Create a verified backup, then recover unused pages on this computer? Requests pause briefly.',
            ),
            [
              { text: uiText('Cancel'), style: 'cancel' },
              { text: uiText('Create backup and recover'), onPress: () => void recover() },
            ],
          )
        }
      />
      {!!status && (
        <Text accessibilityLiveRegion="polite" selectable>
          {status}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
