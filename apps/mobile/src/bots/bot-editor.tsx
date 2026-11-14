import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useRef, type ReactNode } from 'react'
import type { BotResources } from '@dovo/protocol'
import { View } from 'react-native'
import { createDetailDrafts, useDetailDraft } from '../runtime/state/detail-drafts'
import { Sheet } from '../ui/layout/sheet'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { useAction } from '../ui/controls/use-action'
import { useTheme } from '../ui/theme'
import { BotFields } from './bot-fields'

export type BotText = {
  name: string
  role: string
  responsibilities: string
  backupAgentId?: string
  originalBackupAgentId?: string
  resources?: BotResources
  expectedRevision?: string
  originalName?: string
  originalRole?: string
  originalResponsibilities?: string
}
const drafts = createDetailDrafts<BotText>()

export function BotEditor({
  draftKey,
  initial,
  unavailable,
  children,
  onSave,
  onClose,
}: {
  draftKey: string
  initial: BotText
  unavailable?: string
  children?: ReactNode | ((draft: BotText, retain: (value: Partial<BotText>) => void) => ReactNode)
  onSave: (value: BotText, retain: (value: Partial<BotText>) => void) => Promise<unknown>
  onClose: () => void
}) {
  const uiText = useInterfaceText()

  const currentKey = useRef(draftKey)
  currentKey.current = draftKey
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const { styles } = useTheme()
  const { draft, setField, clear } = useDetailDraft(drafts, draftKey, () => initial)
  const retain = (update: Partial<BotText>) => {
    for (const key of Object.keys(update) as (keyof BotText)[]) setField(key, update[key])
  }
  const { busy, error, act } = useAction()
  return (
    <Sheet
      title={uiText('Settings')}
      busy={busy}
      onClose={onClose}
      footer={
        <Action
          label={uiText('Save Bot')}
          wide
          disabled={busy || !!unavailable || !draft.name.trim() || !draft.role.trim()}
          onPress={() =>
            act(async () => {
              if (unavailable || !draft.name.trim() || !draft.role.trim()) return
              await onSave(
                { ...draft, name: draft.name.trim(), role: draft.role.trim() },
                (update) => {
                  for (const key of Object.keys(update) as (keyof BotText)[])
                    setField(key, update[key])
                },
              )
              const latest = drafts.read(draftKey)
              if (
                !latest ||
                (latest.name === draft.name &&
                  latest.role === draft.role &&
                  latest.backupAgentId === draft.backupAgentId &&
                  latest.responsibilities === draft.responsibilities &&
                  JSON.stringify(latest.resources) === JSON.stringify(draft.resources))
              )
                clear()
              if (mounted.current && currentKey.current === draftKey) onClose()
            })
          }
        />
      }
    >
      <View style={{ gap: 16 }}>
        {!!unavailable && (
          <Text accessibilityRole="alert" style={styles.muted}>
            {unavailable}
          </Text>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <BotFields
          {...draft}
          disabled={busy || !!unavailable}
          onName={(value) => setField('name', value)}
          onRole={(value) => setField('role', value)}
          onResponsibilities={(value) => setField('responsibilities', value)}
        />
        {typeof children === 'function' ? children(draft, retain) : children}
        <Text style={styles.muted}>Closing this sheet keeps your unsaved edits.</Text>
      </View>
    </Sheet>
  )
}
