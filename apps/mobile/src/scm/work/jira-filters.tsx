import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
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
  const uiText = useInterfaceText()

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {[
        { label: uiText('Open'), state: 'open', assignee: 'all' as const },
        { label: uiText('My issues'), state: 'open', assignee: 'mine' as const },
        { label: uiText('Unassigned'), state: 'open', assignee: 'unassigned' as const },
        { label: uiText('Done'), state: 'closed', assignee: 'all' as const },
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
  const uiText = useInterfaceText()

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
        placeholder={uiText('Search or enter {value0}…', { value0: label.toLowerCase() })}
        onChangeText={setDraft}
        onSubmitEditing={() => onChange(draft.trim())}
      />
      <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
        {!!draft.trim() && (
          <JiraChip
            label={uiText('Use {value0}', { value0: draft.trim() })}
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
            label={uiText('Clear {value0}', { value0: label.toLowerCase() })}
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
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Suggestions come from loaded issues. Filters search Jira. My issues uses the Jira account signed in on each source computer. Team uses the standard Team field; enter the team ID from its Jira team URL.'
          }
        </InterfaceText>
      </Text>
      <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
        {(['all', 'mine', 'unassigned'] as const).map((assignee) => (
          <JiraChip
            key={assignee}
            label={
              assignee === 'all'
                ? uiText('Anyone')
                : assignee === 'mine'
                  ? uiText('Assigned to me')
                  : uiText('Unassigned')
            }
            selected={(filters.assignee ?? 'all') === assignee}
            onPress={() => onFilters({ ...filters, assignee })}
          />
        ))}
      </View>
      <Text style={styles.muted}>
        <InterfaceText>{'Status category'}</InterfaceText>
      </Text>
      <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
        {(['todo', 'in-progress', 'done'] as const).map((statusCategory) => (
          <JiraChip
            key={statusCategory}
            label={
              statusCategory === 'todo'
                ? uiText('To do')
                : statusCategory === 'done'
                  ? uiText('Done')
                  : uiText('In progress')
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
          label={uiText('All statuses')}
          selected={state === 'all' && !filters.statusCategory}
          onPress={() => {
            onState('all')
            onFilters({ ...filters, statusCategory: undefined })
          }}
        />
      </View>
      <SuggestedFilter
        key={`status:${state}`}
        label={uiText('Exact workflow status')}
        value={['all', 'open', 'closed'].includes(state) ? '' : state}
        suggestions={issues.map((issue) => issue.state)}
        onChange={(value) => {
          onState(value || 'all')
          onFilters({ ...filters, statusCategory: undefined })
        }}
      />
      {(['priority', 'type', 'label', 'team', 'component', 'release'] as const).map((field) => (
        <SuggestedFilter
          key={`${field}:${filters[field] ?? ''}`}
          label={
            field === 'type'
              ? uiText('Issue type')
              : field === 'label'
                ? uiText('Label')
                : field === 'priority'
                  ? uiText('Priority')
                  : field === 'team'
                    ? uiText('Team ID')
                    : field === 'component'
                      ? uiText('Component')
                      : uiText('Release')
          }
          value={filters[field] ?? ''}
          suggestions={issues.flatMap((issue) =>
            field === 'label'
              ? issue.labels
              : field === 'type'
                ? [issue.type]
                : field === 'priority' && issue.priority
                  ? [issue.priority]
                  : [],
          )}
          onChange={(value) => onFilters({ ...filters, [field]: value || undefined })}
        />
      ))}
    </View>
  )
}
