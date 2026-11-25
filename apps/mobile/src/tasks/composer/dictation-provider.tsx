import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { useDictation } from './use-dictation'
import { useRuntimeDictation, type RuntimeSpeechInput } from './use-runtime-dictation'
import type { DictationCallbacks, DictationState } from './dictation'

type Owner = { key: string; title: string; remote: boolean }
const isActive = (state: DictationState) =>
  state.isStarting || state.isRecording || state.isStopping

function useDictationService() {
  const local = useDictation()
  const runtime = useRuntimeDictation()
  const [owner, setOwner] = useState<Owner>()
  const currentOwner = useRef<Owner | undefined>(undefined)
  const starting = useRef(false)
  const speech = owner?.remote ? runtime : local
  const busy = isActive(speech)
  return {
    local,
    runtime,
    owner,
    busy,
    cancel(key: string) {
      const current = currentOwner.current
      if (current?.key === key) return (current.remote ? runtime : local).cancel()
    },
    async start(
      key: string,
      title: string,
      input: RuntimeSpeechInput | undefined,
      callbacks: DictationCallbacks,
    ) {
      if (starting.current || busy) return
      starting.current = true
      const next = { key, title, remote: !!input }
      currentOwner.current = next
      setOwner(next)
      try {
        if (input) {
          runtime.clearError()
          await runtime.start(input, callbacks)
        } else {
          local.clearError()
          await local.start(callbacks)
        }
      } finally {
        starting.current = false
      }
    },
  }
}

const DictationContext = createContext<ReturnType<typeof useDictationService> | null>(null)
export function MobileDictationProvider({
  children,
  draftKey,
}: {
  children: ReactNode
  draftKey?: string
}) {
  const service = useDictationService()
  const uiText = useInterfaceText()
  const { colors, styles } = useTheme()
  const owner = service.owner
  const speech = owner?.remote ? service.runtime : service.local
  return (
    <DictationContext.Provider value={service}>
      {owner && owner.key !== draftKey && (service.busy || speech.error) && (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 6,
            borderBottomWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={styles.muted}>
            {speech.error || uiText('Dictation in {value0}', { value0: owner.title })}
          </Text>
          {speech.isRecording ? (
            <Action label={uiText('Finish dictation')} onPress={() => void speech.stop()} />
          ) : service.busy ? (
            <Text style={styles.muted}>
              {speech.isStopping ? uiText('Transcribing…') : uiText('Starting microphone…')}
            </Text>
          ) : (
            <Action label={uiText('Dismiss')} secondary onPress={speech.clearError} />
          )}
        </View>
      )}
      {children}
    </DictationContext.Provider>
  )
}

export function useMobileDictation() {
  const service = useContext(DictationContext)
  if (!service) throw new Error('MobileDictationProvider is required')
  return service
}
