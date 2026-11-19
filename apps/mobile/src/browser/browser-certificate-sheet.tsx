import {
  browserCertificateEntries,
  browserPageCertificateSchema,
  decodeResult,
  type BrowserPageCertificate,
} from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/content/text'
import { Sheet } from '../ui/layout/sheet'
import { useTheme } from '../ui/theme'
import { DovoWebKitBrowser } from './native-browser'

export function BrowserCertificateSheet({
  tabId,
  documentId,
  origin,
  nativeAvailable,
  onClose,
}: {
  tabId: string
  documentId?: string
  origin: string
  nativeAvailable: boolean
  onClose: () => void
}) {
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  const [details, setDetails] = useState<BrowserPageCertificate>()
  const [error, setError] = useState('')
  const http = origin.startsWith('http://')
  const available = nativeAvailable && !!DovoWebKitBrowser?.getPageCertificate
  useEffect(() => {
    let active = true
    if (available && !http && documentId && DovoWebKitBrowser?.getPageCertificate) {
      void DovoWebKitBrowser.getPageCertificate(tabId, documentId, origin).then(
        (result) => {
          if (!active) return
          const checked = decodeResult(browserPageCertificateSchema, result)
          if (checked.success && checked.data.origin === origin) setDetails(checked.data)
          else setError('No certificate is available for the current page.')
        },
        (cause) => {
          if (active)
            setError(
              cause instanceof Error ? cause.message : 'Could not read the website certificate.',
            )
        },
      )
    }
    return () => {
      active = false
    }
  }, [available, http, documentId, origin, tabId])
  let message = 'Reading the website certificate…'
  if (http) message = 'This page uses HTTP and has no TLS certificate.'
  else if (!nativeAvailable) message = 'This device browser does not expose website certificates.'
  else if (!available)
    message = 'Update Dovo Studio to inspect website certificates on this device.'
  else if (!documentId) message = 'Wait for the page to load, then open the certificate again.'
  return (
    <Sheet title={uiText('Website certificate')} onClose={onClose}>
      <Text selectable style={styles.title}>
        {origin}
      </Text>
      {details && 'leaf' in details && (
        <Text style={styles.muted}>
          {uiText('The browser did not provide the certificate chain.')}
        </Text>
      )}
      {details ? (
        browserCertificateEntries(details).map((cert, index) => (
          <View key={cert.fingerprint256 ?? index} style={{ gap: 6 }}>
            <Text selectable style={styles.title}>
              {cert.subject ||
                (index === 0 ? uiText('Website certificate') : uiText('Issuer certificate'))}
            </Text>
            {(
              [
                ['Issuer', cert.issuer],
                ['Valid from', cert.validFrom],
                ['Valid until', cert.validTo],
                ['Serial number', cert.serialNumber],
                ['SHA-256 fingerprint', cert.fingerprint256],
              ] as const
            ).map(([label, value]) =>
              value ? (
                <Text key={label} selectable>
                  {uiText(label)}
                  {'\n'}
                  {value}
                </Text>
              ) : null,
            )}
          </View>
        ))
      ) : (
        <Text style={styles.muted}>{error || uiText(message)}</Text>
      )}
    </Sheet>
  )
}
