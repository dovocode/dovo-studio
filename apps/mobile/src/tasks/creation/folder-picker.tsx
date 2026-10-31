import { projectIcon, projectIconColor, projectIconInitials } from '@dovo/protocol'
import { RuntimeIcon } from '../../ui/content/runtime-icon'
import type { ReactNode } from 'react'
import {
  runtimeComputerName,
  taskProjectGroups,
  preferredProjectEntry,
  projectDefaultServer,
  type Repository,
} from '@dovo/protocol'
import { Image, Pressable, View } from 'react-native'
import { useApplicationState } from '../../runtime/state/application-state'
import { Sheet } from '../../ui/layout/sheet'
import { SearchField } from '../../ui/controls/field'
import { Icon } from '../../ui/controls/icon'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { RuntimeScope, useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { ProjectTransferDialog } from '../../scm/connections/project-transfer'
import { AddProject } from '../../screens/repositories'
import { ImportCodexSession } from './import-codex-session'

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
  autoProject = false,
  onAuto,
  prominent = false,
  renderControls,
}: {
  prominent?: boolean
  renderControls?: (project: ReactNode, server: ReactNode) => ReactNode
  autoProject?: boolean
  onAuto?: () => Promise<void>
  stacked?: boolean
  repositories: readonly Repository[]
  value: string
  disabled?: boolean
  onChange: (
    id: string,
    repository: Repository,
    runtimeId: string,
    preserveAuto?: boolean,
  ) => void | Promise<void>
  onAdded?: (repository: Repository, runtimeId: string) => void
  chatOnly?: boolean
  allowMachineChange?: boolean
  onMoving?: (moving: boolean) => void
}) {
  const { colors, styles } = useTheme()
  const runtime = useRuntime()
  const [open, setOpen] = useApplicationState(false)
  const [transferring, setTransferring] = useApplicationState(false)
  const [mode, setMode] = useApplicationState<'projects' | 'servers' | 'add-runtime'>('projects')
  const [query, setQuery] = useApplicationState('')
  const [adding, setAdding] = useApplicationState<string | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const selected = repositories.find((repository) => repository.id === value)
  const label = (repository: Repository) =>
    repository.kind === 'scratch' ? 'No Project' : repository.name
  const sources = runtime.overviews.filter(
    (entry) => allowMachineChange || entry.profile.id === runtime.activeId,
  )
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
  const choose = async (repository: Repository, runtimeId: string, preserveAuto = false) => {
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
      await onChange(repository.id, repository, runtimeId, preserveAuto)
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
    const selected =
      !autoProject &&
      group.entries.some(
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
        <Icon name={group.key === 'scratch' ? 'noProject' : 'folder'} size={18} />
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
  const chooseAuto = async () => {
    if (locked || !onAuto) return
    if (autoProject) {
      setOpen(false)
      return
    }
    setBusy(true)
    onMoving?.(true)
    setError('')
    try {
      await onAuto()
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      onMoving?.(false)
    }
  }
  const projectSelected = autoProject || (!!selected && selected.kind !== 'scratch')
  const selectedProject = !autoProject && selected?.kind !== 'scratch' ? selected : undefined
  const prominentLabel = selectedProject?.name ?? 'Scope'
  const selectedIcon = projectIcon(selectedProject)
  const projectMark = selectedProject ? (
    <View
      testID="Selected project icon"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selectedIcon ? 'transparent' : projectIconColor(selectedProject),
      }}
    >
      {selectedIcon ? (
        <Image source={{ uri: selectedIcon }} style={{ width: 16, height: 16 }} />
      ) : (
        <Text style={{ fontSize: 8, color: '#fff', fontWeight: '700' }}>
          {projectIconInitials(selectedProject)}
        </Text>
      )}
    </View>
  ) : (
    <Icon name="scope" size={15} color={colors.muted} />
  )
  const scopeDisabled = locked || (!selectedProject && !onAuto)
  const projectLabel = autoProject
    ? onAuto
      ? 'Scope'
      : 'Scope (disabled)'
    : selected
      ? label(selected)
      : 'Choose project'
  const projectControl =
    prominent && onAuto ? (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          maxWidth: '100%',
          borderWidth: 1,
          borderRadius: 10,
          borderColor: projectSelected ? colors.accent : colors.border,
          backgroundColor: projectSelected ? colors.selection : 'transparent',
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            selectedProject ? `Selected project: ${prominentLabel}` : 'Start in Scope'
          }
          accessibilityState={{ selected: projectSelected, disabled: scopeDisabled }}
          accessibilityHint={
            selectedProject
              ? 'Choose a different project or Scope'
              : 'Find the right projects for your task'
          }
          disabled={scopeDisabled}
          onPress={() => (selectedProject ? show('projects') : void chooseAuto())}
          style={[
            styles.row,
            {
              justifyContent: 'center',
              flexWrap: 'nowrap',
              minWidth: 76,
              maxWidth: 180,
              flexShrink: 1,
              minHeight: 44,
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderWidth: 0,
              borderRightWidth: 0,
              borderTopLeftRadius: 10,
              borderBottomLeftRadius: 10,
              borderColor: projectSelected ? colors.accent : colors.border,
              backgroundColor: 'transparent',
              opacity: scopeDisabled ? 0.45 : 1,
            },
          ]}
        >
          {projectMark}
          <Text
            numberOfLines={1}
            style={{
              color: projectSelected ? colors.accent : colors.muted,
              fontSize: 13,
              fontWeight: projectSelected ? '600' : '500',
              flexShrink: 1,
            }}
          >
            {prominentLabel}
          </Text>
          {projectSelected && <Icon name="check" size={14} color={colors.accent} />}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose project"
          accessibilityValue={{
            text: prominentLabel,
          }}
          accessibilityState={{
            disabled: locked,
            expanded: open && mode === 'projects',
          }}
          disabled={locked}
          onPress={() => show('projects')}
          style={[
            styles.row,
            {
              justifyContent: 'center',
              flexWrap: 'nowrap',
              gap: 4,
              minWidth: 44,
              flexShrink: 0,
              minHeight: 44,
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderWidth: 0,
              borderTopRightRadius: 10,
              borderBottomRightRadius: 10,
              borderColor: projectSelected ? colors.accent : colors.border,
              backgroundColor: 'transparent',
              opacity: locked ? 0.45 : 1,
            },
          ]}
        >
          <Icon name="down" size={14} />
        </Pressable>
      </View>
    ) : (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={prominent ? 'Choose project' : 'Folder'}
        accessibilityValue={{ text: projectLabel }}
        accessibilityState={{
          selected: prominent && projectSelected,
          disabled: locked,
          expanded: open && mode === 'projects',
        }}
        disabled={locked}
        onPress={() => show('projects')}
        style={[
          styles.row,
          {
            flex: prominent || stacked ? undefined : 1,
            maxWidth: prominent ? 240 : undefined,
            flexWrap: 'nowrap',
            padding: 12,
            minHeight: 44,
            borderWidth: prominent ? 1 : 0,
            borderColor: projectSelected ? colors.accent : colors.border,
            borderRadius: 12,
            backgroundColor: prominent
              ? projectSelected
                ? colors.selection
                : 'transparent'
              : colors.surface,
            opacity: locked ? 0.45 : 1,
          },
        ]}
      >
        {prominent ? (
          projectMark
        ) : (
          <Icon
            name={autoProject ? 'scope' : selected?.kind === 'scratch' ? 'noProject' : 'folder'}
            size={18}
          />
        )}
        <Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>
          {prominent ? (selectedProject?.name ?? 'Choose project') : projectLabel}
        </Text>
        {prominent && projectSelected && <Icon name="check" size={14} color={colors.accent} />}
        <Icon name="down" size={14} />
      </Pressable>
    )
  const serverControl =
    multipleMachines || (stacked && !!runtime.profile) ? (
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
            flex: prominent || stacked ? undefined : 1,
            minWidth: prominent ? 0 : undefined,
            maxWidth: prominent ? 220 : undefined,
            flexWrap: 'nowrap',
            padding: prominent ? 8 : 12,
            gap: prominent ? 4 : 6,
            minHeight: 44,
            borderWidth: 0,
            borderColor: colors.border,
            borderRadius: prominent ? 10 : 12,
            backgroundColor: prominent ? 'transparent' : colors.surface,
            opacity: locked ? 0.45 : 1,
          },
        ]}
      >
        <RuntimeIcon icon={runtime.snapshot?.runtimeIcon} size={prominent ? 14 : 18} />
        <Text
          numberOfLines={1}
          style={[styles.text, { flex: 1 }, prominent ? { fontSize: 12 } : undefined]}
        >
          {runtimeComputerName(runtime)}
        </Text>
        <Icon name="down" size={14} />
      </Pressable>
    ) : null
  return (
    <>
      {renderControls ? (
        renderControls(projectControl, serverControl)
      ) : (
        <View style={stacked ? { gap: 8 } : [styles.row, { gap: 8 }]}>
          {projectControl}
          {serverControl}
        </View>
      )}
      {prominent && !autoProject && selected && selected.kind !== 'scratch' && (
        <ImportCodexSession
          key={`${runtime.activeId}:${selected.id}`}
          repositoryId={selected.id}
          disabled={locked}
        />
      )}
      {open && !adding && !transferring && (
        <Sheet
          title={
            mode === 'projects' ? 'Project' : mode === 'add-runtime' ? 'Select runtime' : 'Server'
          }
          headerAction={
            mode === 'projects'
              ? {
                  label: 'Add project',
                  icon: 'add',
                  disabled:
                    locked || !sources.some((source) => source.connected && source.snapshot),
                  onPress: () => setMode('add-runtime'),
                }
              : undefined
          }
          busy={busy}
          onClose={() => setOpen(false)}
        >
          {mode === 'projects' ? (
            <>
              {!prominent && scratch && projectRow(scratch)}
              {onAuto && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Scope mode"
                  accessibilityState={{ selected: autoProject, disabled: locked || !onAuto }}
                  accessibilityHint={
                    !onAuto
                      ? 'Enable Scope on this computer to select projects automatically.'
                      : undefined
                  }
                  disabled={locked || !onAuto}
                  onPress={() => void chooseAuto()}
                  style={[styles.row, { padding: 12, minHeight: 48 }]}
                >
                  <Icon name="scope" size={18} />
                  <Text style={[styles.text, { flex: 1 }]}>Scope</Text>
                  {autoProject && <Icon name="check" size={17} />}
                </Pressable>
              )}
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
            </>
          ) : mode === 'add-runtime' ? (
            <>
              <Text style={styles.muted}>Choose where to add the project.</Text>
              {sources.map((source) => (
                <Pressable
                  key={source.profile.id}
                  accessibilityRole="button"
                  accessibilityLabel={runtimeComputerName(source)}
                  accessibilityState={{ disabled: locked || !source.connected || !source.snapshot }}
                  disabled={locked || !source.connected || !source.snapshot}
                  onPress={() => setAdding(source.profile.id)}
                  style={[
                    styles.row,
                    {
                      padding: 12,
                      minHeight: 48,
                      borderRadius: 10,
                      opacity: source.connected && source.snapshot ? 1 : 0.45,
                    },
                  ]}
                >
                  <RuntimeIcon icon={source.snapshot?.runtimeIcon} size={18} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.text}>{runtimeComputerName(source)}</Text>
                    {!source.connected && <Text style={styles.muted}>Offline</Text>}
                  </View>
                  <Icon name="down" size={14} />
                </Pressable>
              ))}
            </>
          ) : (
            <>
              <Text style={styles.muted}>
                {autoProject
                  ? 'Select projects automatically on'
                  : `Run ${selected?.kind === 'scratch' ? 'No Project' : selected?.name} on`}
              </Text>
              {sources.map((source) => {
                const target = (
                  source.profile.id === runtime.activeId
                    ? repositories
                    : (source.snapshot?.workspace.repositories ?? [])
                ).find((item) =>
                  autoProject || selected?.kind === 'scratch'
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
                    onPress={() => void choose(target, source.profile.id, true)}
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
                    <RuntimeIcon icon={source.snapshot?.runtimeIcon} size={18} />
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
          {mode === 'servers' && !autoProject && selected && selected.kind !== 'scratch' && (
            <Action
              secondary
              label="Add to another machine"
              disabled={locked || !runtime.connected}
              onPress={() => setTransferring(true)}
            />
          )}
          {busy && <Text style={styles.muted}>Selecting project…</Text>}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </Sheet>
      )}
      {transferring && selected && (
        <ProjectTransferDialog
          repository={selected}
          onClose={() => {
            setTransferring(false)
            setOpen(false)
          }}
        />
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
