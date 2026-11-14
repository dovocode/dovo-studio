import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { View } from 'react-native'
import type { JiraIssueFilters } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { Choice } from '../../ui/controls/choice'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'
import { useJiraBrowse } from './use-jira-browse'
import type { WorkSource } from './work-sources'

export function JiraBrowseControls({
  source,
  filters,
  onFilters,
  enabled,
}: {
  source?: WorkSource
  filters: JiraIssueFilters
  onFilters: (value: JiraIssueFilters) => void
  enabled: boolean
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const [closed, setClosed] = useState(false)
  const { boards, sprints } = useJiraBrowse(source, filters.board, closed, enabled)
  return (
    <View style={{ gap: 12 }}>
      {!source && (
        <Text style={styles.muted}>
          <InterfaceText>{'Choose one source to browse its saved boards.'}</InterfaceText>
        </Text>
      )}
      <Choice
        label={uiText('Saved Jira board')}
        value={filters.board ?? ''}
        disabled={!source}
        onChange={(board) => {
          setClosed(false)
          onFilters({ ...filters, board: board || undefined, sprint: undefined })
        }}
        items={[
          { id: '', name: uiText('All project issues') },
          ...(filters.board && !boards.value?.boards.some((board) => board.id === filters.board)
            ? [{ id: filters.board, name: `Board ${filters.board}` }]
            : []),
          ...(boards.value?.boards.map((board) => ({
            id: board.id,
            name: `${board.name} · ${board.type}`,
          })) ?? []),
        ]}
      />
      <Choice
        label={uiText('Jira sprint')}
        value={filters.sprint ?? ''}
        onChange={(sprint) => onFilters({ ...filters, sprint: sprint || undefined })}
        items={[
          { id: '', name: uiText('All sprints') },
          ...(!filters.board
            ? [
                { id: 'active', name: uiText('Active sprints') },
                { id: 'future', name: uiText('Future sprints') },
                { id: 'none', name: uiText('No sprint') },
              ]
            : []),
          ...(filters.sprint &&
          !['active', 'future', 'none'].includes(filters.sprint) &&
          !sprints.value?.sprints.some((sprint) => sprint.id === filters.sprint)
            ? [{ id: filters.sprint, name: `Sprint ${filters.sprint}` }]
            : []),
          ...(sprints.value?.sprints.map((sprint) => ({
            id: sprint.id,
            name: `${sprint.name} · ${sprint.state}`,
          })) ?? []),
        ]}
      />
      {!!filters.board && (
        <Action
          secondary
          label={closed ? uiText('Show active & future sprints') : uiText('Show closed sprints')}
          onPress={() => setClosed((value) => !value)}
        />
      )}
      <Action
        secondary
        label={uiText('Refresh board choices')}
        disabled={!source?.connected || boards.busy || sprints.busy}
        onPress={() => {
          boards.retry()
          if (filters.board) sprints.retry()
        }}
      />
      {(boards.busy || sprints.busy) && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          <InterfaceText>{'Loading boards & sprints…'}</InterfaceText>
        </Text>
      )}
      {[boards, sprints].map((resource, index) =>
        resource.error ? (
          <View key={index} style={{ gap: 8 }}>
            <Text accessibilityRole="alert" style={styles.error}>
              {resource.error}
            </Text>
            <Action
              secondary
              label={uiText('Retry {value0}', { value0: index ? 'sprints' : 'boards' })}
              disabled={!source?.connected || resource.busy}
              onPress={resource.retry}
            />
          </View>
        ) : null,
      )}
      {(boards.value?.stale || sprints.value?.stale) && (
        <Text style={styles.muted}>
          <InterfaceText>{'Saved board and sprint choices.'}</InterfaceText>
        </Text>
      )}
      {(boards.value?.truncated || sprints.value?.truncated) && (
        <Text style={styles.muted}>
          <InterfaceText>{'Some choices are omitted. Open Jira for the full list.'}</InterfaceText>
        </Text>
      )}
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Boards select available sprints. Choose a sprint to narrow issues to that board. Results stay within this source’s project.'
          }
        </InterfaceText>
      </Text>
    </View>
  )
}
