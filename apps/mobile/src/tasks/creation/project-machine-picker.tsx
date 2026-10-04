import { runtimeComputerName } from '@dovo/protocol'
import { useApplicationState } from '../../runtime/state/application-state'
import { projectMachineGroups } from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../../runtime/connection/provider'
import { View, ScrollView, Pressable } from 'react-native'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { SearchField } from '../../ui/controls/field'
import { Icon } from '../../ui/controls/icon'
import { colors, styles } from '../../ui/theme'
import { NewTask } from './new-task'
import { useMemo } from 'react'

export function ProjectMachinePicker({
  onCreated,
  noProject = false,
  onCancel,
}: {
  noProject?: boolean
  onCreated: (runtimeId: string, taskId: string) => void
  onCancel: () => void
}) {
  const { overviews, activeId } = useRuntime()
  const [selection, setSelection] = useApplicationState<{
    runtimeId: string
    repositoryId: string
  } | null>(null)
  const [query, setQuery] = useApplicationState('')
  const [expandedProject, setExpandedProject] = useApplicationState<string | null>(null)
  const groups = useMemo(
    () =>
      projectMachineGroups(
        overviews.flatMap((entry) =>
          (entry.snapshot?.workspace.repositories ?? [])
            .filter((repository) => repository.kind !== 'scratch')
            .map((repository) => ({
              repository,
              runtimeId: entry.profile.id,
              entry,
            })),
        ),
      ),
    [overviews],
  )
  const normalizedQuery = query.trim().toLowerCase()
  if (selection)
    return (
      <RuntimeScope runtimeId={selection.runtimeId}>
        <NewTask
          repositoryId={selection.repositoryId}
          onCancel={() => setSelection(null)}
          onCreated={(id) => onCreated(selection.runtimeId, id)}
        />
      </RuntimeScope>
    )
  if (noProject)
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>New task without a project</Text>
        <Text style={styles.muted}>Choose the computer where this task should run.</Text>
        {overviews.map((entry) => {
          const repository = entry.snapshot?.workspace.repositories.find(
            (item) => item.kind === 'scratch',
          )
          return (
            <Action
              key={entry.profile.id}
              label={`${runtimeComputerName(entry)}${entry.connected ? '' : ' · Offline'}`}
              disabled={!entry.connected || !repository}
              onPress={() => {
                if (repository)
                  setSelection({ runtimeId: entry.profile.id, repositoryId: repository.id })
              }}
            />
          )
        })}
        <Action secondary label="Cancel" onPress={onCancel} />
      </ScrollView>
    )
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Choose a project</Text>
      <Text style={styles.muted}>
        Choose where to work. Nothing runs until you send your first message.
      </Text>
      <SearchField label="Search projects and machines" value={query} onChangeText={setQuery} />
      {groups
        .filter((group) =>
          group.entries.some(({ repository, entry }) =>
            `${group.identity ?? ''} ${repository.name} ${repository.path} ${runtimeComputerName(entry)}`
              .toLowerCase()
              .includes(normalizedQuery),
          ),
        )
        .map((group) => {
          const devices = new Set(group.entries.map(({ runtimeId }) => runtimeId)).size
          const online = new Set(
            group.entries.filter(({ entry }) => entry.connected).map(({ runtimeId }) => runtimeId),
          ).size
          const preferred =
            group.entries.find(
              ({ runtimeId, entry, repository }) =>
                runtimeId === activeId && entry.connected && !repository.gitIdentityError,
            ) ??
            group.entries.find(
              ({ entry, repository }) => entry.connected && !repository.gitIdentityError,
            )
          const choice = preferred ?? group.entries[0]
          const expanded = expandedProject === group.key && devices > 1
          return (
            <View key={group.key} style={[styles.card, { padding: 0, gap: 0, overflow: 'hidden' }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${group.name}, ${devices} ${devices === 1 ? 'machine' : 'machines'}`}
                accessibilityState={{
                  expanded: devices > 1 ? expanded : undefined,
                  disabled: devices === 1 && !preferred,
                }}
                disabled={devices === 1 && !preferred}
                onPress={() => {
                  if (devices > 1) setExpandedProject(expanded ? null : group.key)
                  else if (preferred)
                    setSelection({
                      runtimeId: preferred.runtimeId,
                      repositoryId: preferred.repository.id,
                    })
                }}
                style={({ pressed }) => ({
                  padding: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  backgroundColor: pressed ? colors.elevated : 'transparent',
                })}
              >
                <Icon name="folder" size={19} color={colors.muted} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={[styles.text, { fontWeight: '600' }]}>
                    {group.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.muted}>
                    {devices > 1
                      ? `${devices} machines · ${online} online · Choose where to run`
                      : `${choice ? runtimeComputerName(choice.entry) : 'Device'} · ${choice?.repository.branch ?? ''}`}
                  </Text>
                  {!preferred && <Text style={styles.muted}>Offline</Text>}
                </View>
                <Icon name="next" size={14} color={colors.muted} />
              </Pressable>
              {expanded &&
                group.entries.map(({ repository, runtimeId, entry }) => {
                  const available = entry.connected && !repository.gitIdentityError
                  return (
                    <Pressable
                      key={`${runtimeId}:${repository.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Run ${group.name} on ${runtimeComputerName(entry)}${available ? '' : ', unavailable'}`}
                      disabled={!available}
                      onPress={() => setSelection({ runtimeId, repositoryId: repository.id })}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                        backgroundColor: pressed ? colors.elevated : 'transparent',
                        opacity: available ? 1 : 0.55,
                      })}
                    >
                      <Icon name="device" size={17} color={colors.muted} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.text}>{runtimeComputerName(entry)}</Text>
                        <Text style={styles.muted}>
                          {repository.branch || 'Project checkout'}
                          {available ? '' : ` · ${repository.gitIdentityError || 'Offline'}`}
                        </Text>
                      </View>
                      {available && <Icon name="next" size={14} color={colors.muted} />}
                    </Pressable>
                  )
                })}
            </View>
          )
        })}
      {!!groups.length &&
        !groups.some((group) =>
          group.entries.some(({ repository, entry }) =>
            `${group.identity ?? ''} ${repository.name} ${repository.path} ${runtimeComputerName(entry)}`
              .toLowerCase()
              .includes(normalizedQuery),
          ),
        ) && <Text style={styles.muted}>No matching projects or machines.</Text>}
      {!groups.length && (
        <Text style={styles.muted}>Add a project on a connected machine to start a task.</Text>
      )}
      <Action secondary label="Cancel" onPress={onCancel} />
    </ScrollView>
  )
}
