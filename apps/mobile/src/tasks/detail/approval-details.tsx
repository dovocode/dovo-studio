import { useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { approvalDetails, type ApprovalDetailField } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

function Fields({ fields }: { fields: ApprovalDetailField[] }) {
  const { styles, colors } = useTheme()
  return (
    <View style={{ gap: 10, minWidth: 0 }}>
      {fields.map((field, index) => (
        <View key={index} style={{ gap: 4, minWidth: 0 }}>
          {!!field.label && (
            <Text style={[styles.muted, { fontSize: 12, fontWeight: '500' }]}>{field.label}</Text>
          )}
          {field.children?.length ? (
            <View style={{ borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: 10 }}>
              <Fields fields={field.children} />
            </View>
          ) : (
            <Text
              selectable
              style={[
                styles.text,
                { fontSize: 13, lineHeight: 19 },
                field.code && {
                  fontFamily: 'monospace',
                  padding: 8,
                  backgroundColor: colors.background,
                  borderRadius: 6,
                },
              ]}
            >
              {field.text}
            </Text>
          )}
        </View>
      ))}
    </View>
  )
}

export function ApprovalDetails({ detail }: { detail: string }) {
  const presentation = useMemo(() => approvalDetails(detail), [detail])
  const [expanded, setExpanded] = useState(false)
  const { styles, colors } = useTheme()
  return (
    <View style={{ minWidth: 0 }}>
      <ScrollView nestedScrollEnabled style={{ maxHeight: 260, flexGrow: 0 }}>
        <Fields fields={presentation.fields} />
      </ScrollView>
      {presentation.json && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Hide full JSON' : 'Show full JSON'}
            accessibilityState={{ expanded }}
            onPress={() => setExpanded(!expanded)}
            style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}
          >
            <Text style={[styles.muted, { fontSize: 12 }]}>{expanded ? '▾' : '▸'} Full JSON</Text>
          </Pressable>
          {expanded && (
            <ScrollView
              nestedScrollEnabled
              style={{
                maxHeight: 260,
                flexGrow: 0,
                borderRadius: 6,
                backgroundColor: colors.background,
              }}
              contentContainerStyle={{ padding: 8 }}
            >
              <Text
                selectable
                style={[styles.text, { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 }]}
              >
                {presentation.raw}
              </Text>
            </ScrollView>
          )}
        </>
      )}
    </View>
  )
}
