import {
  runtimeComputerName,
  taskProjectGroups,
  preferredProjectEntry,
  projectDefaultServer,
  type Repository,
} from '@dovo/protocol'
import { Pressable, View } from 'react-native'
import { useApplicationState } from '../../runtime/state/application-state'
import { Sheet } from '../../ui/layout/sheet'
import { SearchField } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { Icon } from '../../ui/controls/icon'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
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
  stacked = false,
}: {
  stacked?: boolean
  repositories: readonly Repository[]
  value: string
  disabled?: boolean
  onChange: (id: string, repository: Repository, runtimeId: string) => void | Promise<void>
  onAdded?: (repository: Repository, runtimeId: string) => void
  chatOnly?: boolean
  allowMachineChange?: boolean
  onMoving?: (moving: boolean) => void
}) {
  const { colors, styles } = useTheme()
  const runtime = useRuntime()
  const [open, setOpen] = useApplicationState(false)
  const [mode, setMode] = useApplicationState<'projects' | 'servers'>('projects')
  const [query, setQuery] = useApplicationState('')
  const [adding, setAdding] = useApplicationState<string | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const selected = repositories.find((repository) => repository.id === value)
  const label = (repository: Repository) =>
    repository.kind === 'scratch' ? 'No project' : repository.name
  const sources = runtime.overviews.filter(
    (entry) => allowMachineChange || entry.profile.id === runtime.activeId,
  )
  const current = sources.find((entry) => entry.profile.id === runtime.activeId)
  const multipleMachines = sources.length > 1
  const groups = taskProjectGroups(
    sources.flatMap((source) =>
      (source.profile.id === runtime.activeId
        ? repositories
        : (source.snapshot?.workspace.repositories ?? [])
      ).map((repository) => ({
        repository,
        source,
        runtimeId: source.profile.id,
        online: source.connected,
        defaults: source.snapshot?.defaults,
      })),
    ),
  )
  const scratch = groups.find((group) => group.key === 'scratch')
  const matches = groups.filter(
    (group) =>
      !chatOnly &&
      group.key !== 'scratch' &&
      group.entries.some(({ repository, source }) =>
        `${group.name} ${repository.path} ${repository.gitIdentity ?? ''} ${runtimeComputerName(source)}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
  )
  const locked = disabled || busy
  const choose = async (repository: Repository, runtimeId: string) => {
    if (
      locked ||
      repository.gitIdentityError ||
      !sources.find((source) => source.profile.id === runtimeId)?.connected
    )
      return
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
  const projectRow = (group: (typeof groups)[number]) => {
    const preferred = preferredProjectEntry(group.entries, runtime.activeId)
    const defaultId = projectDefaultServer(group.entries)
    const defaultSource = sources.find((entry) => entry.profile.id === defaultId)
    const identityError =
      !preferred &&
      group.entries.find((entry) => entry.repository.gitIdentityError)?.repository.gitIdentityError
    const selected = group.entries.some(
      (entry) => entry.runtimeId === runtime.activeId && entry.repository.id === value,
    )
    const serverCount = new Set(group.entries.map((entry) => entry.runtimeId)).size
    return (
      <Pressable
        key={group.key}
        accessibilityRole="button"
        accessibilityLabel={group.name}
        accessibilityState={{ selected, disabled: locked || !preferred }}
        disabled={locked || !preferred}
        onPress={() => {
          if (preferred) void choose(preferred.repository, preferred.runtimeId)
        }}
        style={[
          styles.row,
          {
            padding: 12,
            minHeight: 48,
            borderRadius: 10,
            opacity: locked || !preferred ? 0.45 : 1,
          },
        ]}
      >
        <Icon name={group.key === 'scratch' ? 'chat' : 'folder'} size={18} />
        <View style={{ flex: 1 }}>
          <Text style={styles.text}>{group.name}</Text>
          {!!identityError && <Text style={styles.error}>{identityError}</Text>}
          {multipleMachines && (
            <Text style={styles.muted}>
              {serverCount > 1
                ? `${serverCount} servers`
                : runtimeComputerName(group.entries[0].source)}
              {defaultSource ? ` · Default: ${runtimeComputerName(defaultSource)}` : ''}
              {!preferred ? ' · Unavailable' : ''}
            </Text>
          )}
        </View>
        {selected && <Icon name="check" size={17} />}
      </Pressable>
    )
  }
  const show = (mode: 'projects' | 'servers') => {
    setMode(mode)
    setQuery('')
    setError('')
    setOpen(true)
  }
  return (
    <>
      <View style={stacked ? { gap: 8 } : [styles.row, { gap: 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Folder"
          accessibilityValue={{ text: selected ? label(selected) : 'Choose project' }}
          accessibilityState={{ disabled: locked, expanded: open && mode === 'projects' }}
          disabled={locked}
          onPress={() => show('projects')}
          style={[
            styles.row,
            {
              flex: stacked ? undefined : 1,
              flexWrap: 'nowrap',
              padding: 12,
              minHeight: 44,
              borderRadius: 12,
              backgroundColor: colors.surface,
              opacity: locked ? 0.45 : 1,
            },
          ]}
        >
          <Icon name={selected?.kind === 'scratch' ? 'chat' : 'folder'} size={18} />
          <Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>
            {selected ? label(selected) : 'Choose project'}
          </Text>
          <Icon name="down" size={14} />
        </Pressable>
        {(multipleMachines || (stacked && !!runtime.profile)) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Task server"
            accessibilityValue={{ text: runtimeComputerName(runtime) }}
            accessibilityState={{ disabled: locked, expanded: open && mode === 'servers' }}
            disabled={locked}
            onPress={() => show('servers')}
            style={[
              styles.row,
              {
                maxWidth: stacked ? '100%' : '45%',
                flexWrap: 'nowrap',
                padding: 12,
                minHeight: 44,
                borderRadius: 12,
                backgroundColor: colors.surface,
                opacity: locked ? 0.45 : 1,
              },
            ]}
          >
            <Icon name="device" size={16} />
            <Text
              numberOfLines={1}
              style={[styles.muted, stacked ? { flex: 1 } : { flexShrink: 1 }]}
            >
              {runtimeComputerName(runtime)}
            </Text>
            <Icon name="down" size={14} />
          </Pressable>
        )}
      </View>
      {open && !adding && (
        <Sheet
          title={mode === 'projects' ? 'Project' : 'Server'}
          busy={busy}
          onClose={() => setOpen(false)}
        >
          {mode === 'projects' ? (
            <>
              {scratch && projectRow(scratch)}
              {!chatOnly && (
                <SearchField
                  label="Search projects"
                  placeholder="Search projects"
                  value={query}
                  onChangeText={setQuery}
                />
              )}
              {matches.map(projectRow)}
              {!chatOnly && !matches.length && (
                <Text style={styles.muted}>
                  {query.trim() ? 'No matching projects.' : 'No projects yet.'}
                </Text>
              )}
              <Action
                secondary
                label={
                  multipleMachines
                    ? `Add project on ${runtimeComputerName(runtime)}`
                    : 'Add project'
                }
                disabled={locked || !current?.connected}
                onPress={() => {
                  if (current) setAdding(current.profile.id)
                }}
              />
            </>
          ) : (
            <>
              <Text style={styles.muted}>
                Run {selected?.kind === 'scratch' ? 'without a project' : selected?.name} on
              </Text>
              {sources.map((source) => {
                const target = (
                  source.profile.id === runtime.activeId
                    ? repositories
                    : (source.snapshot?.workspace.repositories ?? [])
                ).find((item) =>
                  selected?.kind === 'scratch'
                    ? item.kind === 'scratch'
                    : selected?.gitIdentity
                      ? item.gitIdentity === selected.gitIdentity
                      : source.profile.id === runtime.activeId && item.id === value,
                )
                if (!target) return null
                const unavailable = !source.connected || !!target.gitIdentityError
                return (
                  <Pressable
                    key={source.profile.id}
                    accessibilityRole="button"
                    accessibilityLabel={runtimeComputerName(source)}
                    accessibilityState={{
                      selected: source.profile.id === runtime.activeId,
                      disabled: locked || unavailable,
                    }}
                    disabled={locked || unavailable}
                    onPress={() => void choose(target, source.profile.id)}
                    style={[
                      styles.row,
                      {
                        padding: 12,
                        minHeight: 48,
                        borderRadius: 10,
                        opacity: unavailable ? 0.45 : 1,
                      },
                    ]}
                  >
                    <Icon name="device" size={18} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.text}>{runtimeComputerName(source)}</Text>
                      {unavailable && (
                        <Text style={styles.muted}>
                          {!source.connected ? 'Offline' : target.gitIdentityError}
                        </Text>
                      )}
                    </View>
                    {source.profile.id === runtime.activeId && <Icon name="check" size={17} />}
                  </Pressable>
                )
              })}
            </>
          )}
          {busy && <Text style={styles.muted}>Selecting project…</Text>}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
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
      {!!error && !open && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </>
  )
}
