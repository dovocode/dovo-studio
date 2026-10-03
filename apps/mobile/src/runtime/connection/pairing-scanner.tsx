import { SafeModal } from '../../ui/layout/safe-modal'
import { useEffect, useRef } from 'react'
import { ActivityIndicator, AppState, Linking, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { parsePairingInvitation, type PairingInvitation } from '@dovo/protocol'
import { useApplicationState } from '../state/application-state'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { colors, styles } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'

export function PairingScanner({
  onScanned,
  onClose,
}: {
  onScanned: (invitation: PairingInvitation) => void
  onClose: () => void
}) {
  const [permission, requestPermission, refreshPermission] = useCameraPermissions()
  const [active, setActive] = useApplicationState(AppState.currentState === 'active')
  const [scanError, setScanError] = useApplicationState('')
  const consumed = useRef(false)
  const { act, busy, error } = useAction()
  const refresh = useRef(() => act(refreshPermission))
  refresh.current = () => act(refreshPermission)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active')
      if (state === 'active') refresh.current()
    })
    return () => {
      consumed.current = true
      subscription.remove()
    }
  }, [])
  return (
    <SafeModal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.screen, { padding: 20, gap: 16 }]}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={styles.title}>Scan pairing QR code</Text>
          <Action secondary label="Cancel" onPress={onClose} />
        </View>
        <Text style={styles.muted}>
          Point your camera at the QR code shown by Dovo Studio or the server’s pair command.
        </Text>
        {!permission ? (
          <ActivityIndicator color={colors.accent} />
        ) : !permission.granted ? (
          <View style={{ gap: 12 }}>
            <Text style={styles.text}>
              Allow camera access to scan a pairing code. You can also enter the address and code
              manually.
            </Text>
            <Action
              label={permission.canAskAgain ? 'Allow camera' : 'Open Settings'}
              disabled={busy}
              onPress={() =>
                act(() => (permission.canAskAgain ? requestPermission() : Linking.openSettings()))
              }
            />
          </View>
        ) : active && !scanError ? (
          <CameraView
            style={{ flex: 1, minHeight: 240, borderRadius: 16, overflow: 'hidden' }}
            facing="back"
            autofocus="on"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onMountError={({ message }) => setScanError(`Could not open the camera: ${message}`)}
            onBarcodeScanned={({ data }) => {
              if (consumed.current || AppState.currentState !== 'active') return
              consumed.current = true
              try {
                onScanned(parsePairingInvitation(data))
              } catch (error) {
                setScanError(error instanceof Error ? error.message : String(error))
              }
            }}
          />
        ) : null}
        {!!(scanError || error) && (
          <Text accessibilityRole="alert" style={styles.error}>
            {scanError || error}
          </Text>
        )}
        {!!scanError && (
          <Action
            secondary
            label="Try another code"
            onPress={() => {
              consumed.current = false
              setScanError('')
            }}
          />
        )}
        <Action secondary label="Enter address and code manually" onPress={onClose} />
      </View>
    </SafeModal>
  )
}
