import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { ForgeIssue, JiraIssueFilters } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { Field } from '../../ui/controls/field'
import { useTheme } from '../../ui/theme'

export function JiraChip({
  label,
  selected = false,
  onPress,
}: {
  label: string
  selected?: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        maxWidth: '100%',
        justifyContent: 'center',
        paddingHorizontal: 12,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text numberOfLines={1} style={{ color: selected ? colors.accent : colors.text }}>
        {label}
      </Text>
    </Pressable>
  )
}

export function JiraQuickViews({
  state,
  filters,
  onChange,
}: {
  state: string
  filters: JiraIssueFilters
  onChange: (state: string, filters: JiraIssueFilters) => void
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {[
        { label: 'Open', state: 'open', assignee: 'all' as const },
        { label: 'My issues', state: 'open', assignee: 'mine' as const },
        { label: 'Unassigned', state: 'open', assignee: 'unassigned' as const },
        { label: 'Done', state: 'closed', assignee: 'all' as const },
      ].map((view) => (
        <JiraChip
          key={view.label}
          label={view.label}
          selected={
            state === view.state &&
            (filters.assignee ?? 'all') === view.assignee &&
            !filters.statusCategory
          }
          onPress={() =>
            onChange(view.state, { ...filters, assignee: view.assignee, statusCategory: undefined })
          }
        />
      ))}
    </ScrollView>
  )
}

function SuggestedFilter({
  label,
  value,
  suggestions,
  onChange,
}: {
  label: string
  value: string
  suggestions: string[]
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const { styles } = useTheme()
  const matches = [...new Set(suggestions)]
    .filter((item) => item.toLowerCase().includes(draft.trim().toLowerCase()))
    .slice(0, 6)
  return (
    <View style={{ gap: 8 }}>
      <Field
        label={label}
        value={draft}
        maxLength={100}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={`Search or enter ${label.toLowerCase()}…`}
        onChangeText={setDraft}
        onSubmitEditing={() => onChange(draft.trim())}
      />
      <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
        {!!draft.trim() && (
          <JiraChip
            label={`Use ${draft.trim()}`}
            selected={value === draft.trim()}
            onPress={() => onChange(draft.trim())}
          />
        )}
        {matches
          .filter((item) => item !== draft.trim())
          .map((item) => (
            <JiraChip
              key={item}
              label={item}
              selected={item === value}
              onPress={() => {
                setDraft(item)
                onChange(item)
              }}
            />
          ))}
        {!!value && (
          <JiraChip
            label={`Clear ${label.toLowerCase()}`}
            onPress={() => {
              setDraft('')
              onChange('')
            }}
          />
        )}
      </View>
    </View>
  )
}

export function JiraFilterFields({
  state,
  filters,
  issues,
  onState,
  onFilters,
}: {
  state: string
  filters: JiraIssueFilters
  issues: ForgeIssue[]
  onState: (state: string) => void
  onFilters: (filters: JiraIssueFilters) => void
}) {
  const { styles } = useTheme()
  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.muted}>
        Suggestions come from loaded issues. Filters search Jira. My issues uses the Jira account
        signed in on each source computer.
      </Text>
      <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
        {(['all', 'mine', 'unassigned'] as const).map((assignee) => (
          <JiraChip
            key={assignee}
            label={
              assignee === 'all' ? 'Anyone' : assignee === 'mine' ? 'Assigned to me' : 'Unassigned'
            }
            selected={(filters.assignee ?? 'all') === assignee}
            onPress={() => onFilters({ ...filters, assignee })}
          />
        ))}
      </View>
      <Text style={styles.muted}>Status category</Text>
      <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
        {(['todo', 'in-progress', 'done'] as const).map((statusCategory) => (
          <JiraChip
            key={statusCategory}
            label={
              statusCategory === 'todo'
                ? 'To do'
                : statusCategory === 'done'
                  ? 'Done'
                  : 'In progress'
            }
            selected={filters.statusCategory === statusCategory}
            onPress={() => {
              onState('all')
              onFilters({
                ...filters,
                statusCategory:
                  filters.statusCategory === statusCategory ? undefined : statusCategory,
              })
            }}
          />
        ))}
        <JiraChip
          label="All statuses"
          selected={state === 'all' && !filters.statusCategory}
          onPress={() => {
            onState('all')
            onFilters({ ...filters, statusCategory: undefined })
          }}
        />
      </View>
      <SuggestedFilter
        key={`status:${state}`}
        label="Exact workflow status"
        value={['all', 'open', 'closed'].includes(state) ? '' : state}
        suggestions={issues.map((issue) => issue.state)}
        onChange={(value) => {
          onState(value || 'all')
          onFilters({ ...filters, statusCategory: undefined })
        }}
      />
      {(['priority', 'type', 'label'] as const).map((field) => (
        <SuggestedFilter
          key={`${field}:${filters[field] ?? ''}`}
          label={field === 'type' ? 'Issue type' : field === 'label' ? 'Label' : 'Priority'}
          value={filters[field] ?? ''}
          suggestions={issues.flatMap((issue) =>
            field === 'label' ? issue.labels : issue[field] ? [issue[field]] : [],
          )}
          onChange={(value) => onFilters({ ...filters, [field]: value || undefined })}
        />
      ))}
    </View>
  )
}
