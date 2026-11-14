import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { contentColumn } from '../ui/layout/content-column'
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from 'react'
import type { SettingsChange } from '@dovo/protocol'
import { View, ScrollView, Pressable } from 'react-native'
import { SettingsAction } from './settings-controls'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { Glass } from '../ui/layout/glass'

export const SettingsFooterContext = createContext<((footer: ReactNode) => void) | null>(null)

/** SettingsPage owns the footer so actions stay outside the scrolling editor. */
export function SettingsSaveBar({
  dirty,
  inline = false,
  saving,
  saveLabel: saveLabelOverride,
  disabled,
  saved,
  changeCount,
  changes = [],
  saveError,
  readLatestChanges,
  onSave,
  onDiscard,
}: {
  inline?: boolean
  saveLabel?: string
  dirty: boolean
  saving: boolean
  disabled?: boolean
  saved?: boolean
  changes?: SettingsChange[]
  saveError?: string
  readLatestChanges?: () => Promise<SettingsChange[]>
  changeCount?: number
  onSave: () => void
  onDiscard: () => void
}) {
  const uiText = useInterfaceText()
  const saveLabel = saveLabelOverride ?? uiText('Save changes')

  const footer = useContext(SettingsFooterContext)
  const setFooter = inline ? null : footer
  const { colors, styles } = useTheme()
  const handlers = useRef({ onSave, onDiscard })
  handlers.current = { onSave, onDiscard }
  const [review, setReview] = useState(false)
  const [latest, setLatest] = useState<SettingsChange[] | null>(null)
  const [reviewError, setReviewError] = useState('')
  const reader = useRef(readLatestChanges)
  reader.current = readLatestChanges
  useEffect(() => {
    setLatest(null)
    setReviewError('')
    if (!saveError || !dirty || !reader.current) return
    let active = true
    void reader.current().then(
      (value) => {
        if (active) {
          setLatest(value)
          setReview(true)
        }
      },
      (error: unknown) => {
        if (active) setReviewError(error instanceof Error ? error.message : String(error))
      },
    )
    return () => {
      active = false
    }
  }, [saveError, dirty])
  const count = changeCount || changes.length || 1
  const status = saving
    ? 'Saving…'
    : dirty
      ? `${count} unsaved ${count === 1 ? 'change' : 'changes'}`
      : saved
        ? 'Changes saved.'
        : 'No unsaved changes'
  const changesKey = JSON.stringify(changes)
  const content = useMemo(
    () => (
      <View
        accessibilityLabel={uiText('Settings save actions')}
        accessibilityState={{ busy: saving }}
        style={{
          ...contentColumn.form,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <Glass testID="Settings save surface" style={{ borderRadius: 24, padding: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                dirty && !saving ? uiText('Review unsaved settings changes') : status
              }
              accessibilityValue={dirty && !saving ? { text: status } : undefined}
              accessibilityState={{ expanded: review, disabled: !dirty }}
              disabled={!dirty || !changes.length}
              onPress={() => setReview((value) => !value)}
              style={{
                minHeight: 44,
                minWidth: 120,
                flexBasis: 120,
                flexGrow: 1,
                flexShrink: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: colors.warning,
                  opacity: dirty ? 1 : 0,
                }}
              />
              <Text accessibilityLiveRegion="polite" style={[styles.muted, { flexShrink: 1 }]}>
                {status}
              </Text>
            </Pressable>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                flexGrow: 1,
                gap: 12,
              }}
            >
              <SettingsAction
                destructive
                secondary
                label={uiText('Discard')}
                disabled={!dirty || saving}
                onPress={() => handlers.current.onDiscard()}
              />
              <SettingsAction
                label={saveLabel}
                disabled={!dirty || saving || disabled}
                onPress={() => handlers.current.onSave()}
              />
            </View>
          </View>
          {dirty && review && (
            <ScrollView
              style={{ maxHeight: 180 }}
              accessibilityLabel={uiText('Settings change review')}
            >
              <Text style={styles.text}>
                <InterfaceText>{'Your changes'}</InterfaceText>
              </Text>
              {changes.map((change) => (
                <View key={change.key} style={{ paddingVertical: 4 }}>
                  <Text style={styles.text}>{change.label}</Text>
                  <Text style={styles.muted}>
                    {change.before} → {change.after}
                  </Text>
                </View>
              ))}
              {latest && (
                <>
                  <Text style={styles.text}>
                    <InterfaceText>{'Latest saved changes · your draft is kept'}</InterfaceText>
                  </Text>
                  {latest.length ? (
                    latest.map((change) => (
                      <View key={change.key} style={{ paddingVertical: 4 }}>
                        <Text style={styles.text}>{change.label}</Text>
                        <Text style={styles.muted}>
                          {change.before} → {change.after}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.muted}>
                      <InterfaceText>{'No remotely changed fields found.'}</InterfaceText>
                    </Text>
                  )}
                  <Text style={styles.muted}>
                    <InterfaceText>
                      {'Discard and reload to use the latest saved settings.'}
                    </InterfaceText>
                  </Text>
                </>
              )}
            </ScrollView>
          )}
          {!!reviewError && (
            <Text accessibilityRole="alert" style={styles.error}>
              <InterfaceText values={{ value0: reviewError }}>
                {'Could not read latest saved changes: {value0}. Your draft is kept.'}
              </InterfaceText>
            </Text>
          )}
        </Glass>
      </View>
    ),
    [
      saveLabel,
      dirty,
      saving,
      disabled,
      saved,
      count,
      status,
      changesKey,
      colors,
      styles,
      review,
      latest,
      reviewError,
      uiText,
    ],
  )
  useLayoutEffect(() => {
    setFooter?.(content)
    return () => setFooter?.(null)
  }, [setFooter, content])
  return setFooter ? null : content
}
