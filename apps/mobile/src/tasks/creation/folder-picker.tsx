import { runtimeComputerName, type Repository } from '@dovo/protocol'
import { Pressable, View } from 'react-native'
import { useApplicationState } from '../../runtime/state/application-state'
import { Sheet } from '../../ui/layout/sheet'
import { SearchField } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { Icon } from '../../ui/controls/icon'
import { Text } from '../../ui/content/text'
import { colors, styles } from '../../ui/theme'
import { RuntimeScope, useRuntime } from '../../runtime/connection/provider'
import { AddProject } from '../../screens/repositories'

export function FolderPicker({
  repositories,
  value,
  disabled = false,
  onChange,
  onAdded,
  allowMachineChange = true,
  chatOnly = false,
  onMoving,
}: {
  repositories: readonly Repository[]
  value: string
  disabled?: boolean
  onChange: (id: string, repository: Repository, runtimeId: string) => void | Promise<void>
  onAdded?: (repository: Repository, runtimeId: string) => void
  chatOnly?: boolean
  allowMachineChange?: boolean
  onMoving?: (moving: boolean) => void
}) {
  const runtime = useRuntime()
  const [open, setOpen] = useApplicationState(false)
  const [machine, setMachine] = useApplicationState<string | null>(null)
  const [query, setQuery] = useApplicationState('')
  const [adding, setAdding] = useApplicationState<string | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const selected = repositories.find((repository) => repository.id === value)
  const label = (repository: Repository) =>
    repository.kind === 'scratch' ? 'Chat' : repository.name
  const sources = runtime.overviews.filter(
    (entry) => allowMachineChange || entry.profile.id === runtime.activeId,
  )
  const selectedMachine = machine ?? runtime.activeId
  const locked = disabled || busy
  const choose = async (repository: Repository, runtimeId: string) => {
    if (locked || repository.gitIdentityError) return
    setBusy(true)
    onMoving?.(true)
    setError('')
    try {
      await onChange(repository.id, repository, runtimeId)
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      onMoving?.(false)
    }
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Folder"
        accessibilityValue={{
          text: `${selected ? label(selected) : 'Choose folder'} · ${runtimeComputerName(runtime)}`,
        }}
        accessibilityState={{ disabled: locked, expanded: open }}
        disabled={locked}
        onPress={() => {
          setMachine(runtime.activeId)
          setQuery('')
          setOpen(true)
        }}
        style={[
          styles.row,
          {
            padding: 12,
            minHeight: 44,
            borderRadius: 12,
            backgroundColor: colors.surface,
            opacity: locked ? 0.45 : 1,
          },
        ]}
      >
        <Icon name="folder" size={18} />
        <Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>
          {selected ? label(selected) : 'Choose folder'}
        </Text>
        <Icon name="device" size={16} />
        <Text numberOfLines={1} style={styles.muted}>
          {runtimeComputerName(runtime)}
        </Text>
        <Icon name="down" size={14} />
      </Pressable>
      {open && !adding && (
        <Sheet title="Machine & project" busy={busy} onClose={() => setOpen(false)}>
          {sources.map((entry) => {
            const expanded = entry.profile.id === selectedMachine
            const folders =
              entry.profile.id === runtime.activeId
                ? repositories
                : (entry.snapshot?.workspace.repositories ?? [])
            const matches = folders.filter(
              (repository) =>
                (!chatOnly || repository.kind === 'scratch') &&
                `${label(repository)} ${repository.path}`
                  .toLowerCase()
                  .includes(query.trim().toLowerCase()),
            )
            return (
              <View key={entry.profile.id} style={{ gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={runtimeComputerName(entry)}
                  accessibilityState={{ expanded, disabled: !entry.connected }}
                  disabled={!entry.connected || locked}
                  onPress={() => {
                    setMachine(entry.profile.id)
                    setQuery('')
                  }}
                  style={[
                    styles.row,
                    {
                      padding: 12,
                      minHeight: 48,
                      borderRadius: 10,
                      backgroundColor: expanded ? colors.elevated : undefined,
                      opacity: entry.connected ? 1 : 0.45,
                    },
                  ]}
                >
                  <Icon name="device" size={18} />
                  <Text style={[styles.text, { flex: 1 }]}>
                    {runtimeComputerName(entry)}
                    {entry.connected ? '' : ' · Offline'}
                  </Text>
                  {entry.profile.id === runtime.activeId && <Icon name="check" size={17} />}
                  <Icon name="down" size={14} />
                </Pressable>
                {expanded && entry.connected && (
                  <View style={{ paddingLeft: 16, gap: 8 }}>
                    <SearchField
                      label="Search folders"
                      placeholder="Search folders"
                      value={query}
                      onChangeText={setQuery}
                    />
                    {matches.map((repository) => (
                      <Pressable
                        key={repository.id}
                        accessibilityRole="button"
                        accessibilityLabel={label(repository)}
                        accessibilityState={{
                          selected:
                            entry.profile.id === runtime.activeId && repository.id === value,
                          disabled: !!repository.gitIdentityError,
                        }}
                        disabled={locked || !!repository.gitIdentityError}
                        onPress={() => {
                          void choose(repository, entry.profile.id)
                        }}
                        style={[
                          styles.row,
                          {
                            padding: 12,
                            minHeight: 48,
                            borderRadius: 10,
                            opacity: repository.gitIdentityError ? 0.45 : 1,
                          },
                        ]}
                      >
                        <Icon name={repository.kind === 'scratch' ? 'chat' : 'folder'} size={18} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.text}>{label(repository)}</Text>
                          {!!repository.gitIdentityError && (
                            <Text style={styles.error}>{repository.gitIdentityError}</Text>
                          )}
                        </View>
                        {entry.profile.id === runtime.activeId && repository.id === value && (
                          <Icon name="check" size={17} />
                        )}
                      </Pressable>
                    ))}
                    {!matches.length && <Text style={styles.muted}>No matching folders.</Text>}
                    <Action
                      secondary
                      label="Add project"
                      disabled={locked}
                      onPress={() => setAdding(entry.profile.id)}
                    />
                  </View>
                )}
              </View>
            )
          })}
        </Sheet>
      )}
      {adding && (
        <RuntimeScope runtimeId={adding}>
          <AddProject
            onAdded={(repository) => {
              onAdded?.(repository, adding)
              void choose(repository, adding)
            }}
            onClose={() => {
              setAdding(null)
              setOpen(false)
            }}
          />
        </RuntimeScope>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </>
  )
}
