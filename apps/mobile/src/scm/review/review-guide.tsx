import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import type { ReviewGuide } from '@dovo/protocol'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function MobileReviewGuide({
  guide,
  busy,
  disabled,
  onMove,
  onOpenFile,
}: {
  guide: ReviewGuide
  busy: boolean
  disabled: boolean
  onMove: (position: number, reviewed?: number) => Promise<boolean>
  onOpenFile: (path: string) => void
}) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const [collapsed, setCollapsed] = useState(false)
  const step = guide.steps[guide.position]
  if (!step) return null
  const blocked = disabled || busy
  return (
    <View
      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 8 }}
      accessibilityLabel={uiText('Guided review')}
    >
      <Action
        secondary
        label={uiText('Guided review · {value0}/{value1} reviewed · {value2}', {
          value0: guide.seen.length,
          value1: guide.steps.length,
          value2: collapsed ? 'Show' : 'Hide',
        })}
        onPress={() => setCollapsed(!collapsed)}
      />
      {!collapsed && (
        <>
          <Text style={styles.muted}>
            <InterfaceText>
              {
                'Model-proposed walkthrough. Verify against the diff. Progress is saved for this revision.'
              }
            </InterfaceText>
          </Text>
          <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: '600' }}>
            <InterfaceText
              values={{
                value0: guide.position + 1,
                value1: guide.steps.length,
                value2: step.title,
              }}
            >
              {'Step {value0}/{value1}: {value2}'}
            </InterfaceText>
          </Text>
          <Text style={{ color: colors.text }}>{step.summary}</Text>
          <Text style={styles.muted}>
            <InterfaceText values={{ value0: step.impact }}>
              {'Review focus: {value0}'}
            </InterfaceText>
          </Text>
          {step.excerpts.map((excerpt, index) => (
            <View key={index} style={{ gap: 4 }}>
              <Text style={styles.muted}>
                <InterfaceText
                  values={{
                    value0: excerpt.path,
                    value1: excerpt.start,
                    value2: excerpt.end,
                    value3: excerpt.side === 'after' ? uiText('new') : uiText('old'),
                  }}
                >
                  {'{value0}:{value1}–{value2} · {value3} version'}
                </InterfaceText>
              </Text>
              <ScrollView horizontal style={{ maxHeight: 220 }}>
                <Text
                  selectable
                  style={{ color: colors.text, fontFamily: 'monospace', fontSize: 12 }}
                >
                  {excerpt.text}
                </Text>
              </ScrollView>
            </View>
          ))}
          {!step.excerpts.length && (
            <Text style={styles.muted}>
              <InterfaceText>
                {'No verified excerpt is available. Inspect the full file diffs.'}
              </InterfaceText>
            </Text>
          )}
          {step.paths.map((path) => (
            <Action
              key={path}
              secondary
              label={uiText('Open {value0}', { value0: path })}
              disabled={disabled}
              onPress={() => onOpenFile(path)}
            />
          ))}
          {!!step.questions.length && (
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                <InterfaceText>{'Questions to check'}</InterfaceText>
              </Text>
              {step.questions.map((question, index) => (
                <Text key={index} style={{ color: colors.text }}>
                  • {question}
                </Text>
              ))}
            </View>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Action
              secondary
              label={uiText('Previous step')}
              disabled={blocked || guide.position === 0}
              onPress={() => void onMove(guide.position - 1)}
            />
            <Action
              secondary
              label={uiText('Next step')}
              disabled={blocked || guide.position >= guide.steps.length - 1}
              onPress={() => void onMove(guide.position + 1)}
            />
            <Action
              label={
                guide.seen.includes(guide.position)
                  ? uiText('Step reviewed')
                  : guide.position === guide.steps.length - 1
                    ? uiText('Mark final step reviewed')
                    : uiText('Mark reviewed and continue')
              }
              disabled={blocked || guide.seen.includes(guide.position)}
              onPress={() =>
                void onMove(Math.min(guide.position + 1, guide.steps.length - 1), guide.position)
              }
            />
          </View>
          {guide.seen.length === guide.steps.length && (
            <Text style={{ color: colors.text }}>
              <InterfaceText>
                {'Walkthrough complete. File viewed marks and review submission remain separate.'}
              </InterfaceText>
            </Text>
          )}
        </>
      )}
    </View>
  )
}
