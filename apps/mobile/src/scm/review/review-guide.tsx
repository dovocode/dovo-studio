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
  const { colors, styles } = useTheme()
  const [collapsed, setCollapsed] = useState(false)
  const step = guide.steps[guide.position]
  if (!step) return null
  const blocked = disabled || busy
  return (
    <View
      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 8 }}
      accessibilityLabel="Guided review"
    >
      <Action
        secondary
        label={`Guided review · ${guide.seen.length}/${guide.steps.length} reviewed · ${collapsed ? 'Show' : 'Hide'}`}
        onPress={() => setCollapsed(!collapsed)}
      />
      {!collapsed && (
        <>
          <Text style={styles.muted}>
            Model-proposed walkthrough. Verify against the diff. Progress is saved for this
            revision.
          </Text>
          <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: '600' }}>
            Step {guide.position + 1}/{guide.steps.length}: {step.title}
          </Text>
          <Text style={{ color: colors.text }}>{step.summary}</Text>
          <Text style={styles.muted}>Review focus: {step.impact}</Text>
          {step.excerpts.map((excerpt, index) => (
            <View key={index} style={{ gap: 4 }}>
              <Text style={styles.muted}>
                {excerpt.path}:{excerpt.start}–{excerpt.end} ·{' '}
                {excerpt.side === 'after' ? 'new' : 'old'} version
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
              No verified excerpt is available. Inspect the full file diffs.
            </Text>
          )}
          {step.paths.map((path) => (
            <Action
              key={path}
              secondary
              label={`Open ${path}`}
              disabled={disabled}
              onPress={() => onOpenFile(path)}
            />
          ))}
          {!!step.questions.length && (
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Questions to check</Text>
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
              label="Previous step"
              disabled={blocked || guide.position === 0}
              onPress={() => void onMove(guide.position - 1)}
            />
            <Action
              secondary
              label="Next step"
              disabled={blocked || guide.position >= guide.steps.length - 1}
              onPress={() => void onMove(guide.position + 1)}
            />
            <Action
              label={
                guide.seen.includes(guide.position)
                  ? 'Step reviewed'
                  : guide.position === guide.steps.length - 1
                    ? 'Mark final step reviewed'
                    : 'Mark reviewed and continue'
              }
              disabled={blocked || guide.seen.includes(guide.position)}
              onPress={() =>
                void onMove(Math.min(guide.position + 1, guide.steps.length - 1), guide.position)
              }
            />
          </View>
          {guide.seen.length === guide.steps.length && (
            <Text style={{ color: colors.text }}>
              Walkthrough complete. File viewed marks and review submission remain separate.
            </Text>
          )}
        </>
      )}
    </View>
  )
}
