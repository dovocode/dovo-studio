import { appVersion, appBuild, appChannel } from '../runtime/preferences/app-build'
import { router } from 'expo-router'
import { View, ScrollView } from 'react-native'
import { useApplicationState } from '../runtime/state/application-state'
import { SettingsGroup, SettingsRow } from './settings-group'
import { SettingsSearchField as SearchField } from './settings-controls'
import { Text } from '../ui/content/text'
import { useSettingsTheme as useTheme, SettingsPage } from './settings-theme'
import { useRuntime } from '../runtime/connection/provider'
import { useSettingsTargetState } from '../runtime/preferences/settings-target'
import { settingsScopeLabels } from '@dovo/protocol'
import { ScreenHeader } from '../ui/layout/screen-header'
import { SettingsAction as Action } from './settings-controls'
import { useEffect } from 'react'
import { clearLastCrash, readLastCrash, type CrashRecord } from '../runtime/diagnostics/crash-log'

/** Where a page saves, shown beside its name and explained under the target summary. */
const storage = {
  computer: { icon: 'device', label: 'Saved per computer' },
  inherited: { icon: 'stack', label: 'Inherits across settings levels', accent: true },
} as const

export default function SettingsScreen() {
  const { colors, styles } = useTheme()

  const { profiles, overviews } = useRuntime()
  const target = useSettingsTargetState()
  const [query, setQuery] = useApplicationState('')
  const [crash, setCrash] = useApplicationState<CrashRecord | null>(null)
  useEffect(() => {
    let active = true
    void readLastCrash().then((record) => {
      if (active) setCrash(record)
    })
    return () => {
      active = false
    }
  }, [setCrash])
  const archived = overviews.reduce(
    (count, entry) =>
      count +
      (entry.snapshot?.workspace.tasks.filter((task) => task.archivedAt && !task.example).length ??
        0),
    0,
  )
  const groups = [
    {
      title: 'This app',
      footer: 'Preferences on this device save automatically.',
      items: [
        {
          title: 'Appearance',
          subtitle: 'Color scheme and desktop theme palettes',
          icon: 'preview',
          path: '/settings/appearance',
          local: true,
          keywords: 'theme system light dark colors palette display',
        },
        {
          title: 'General',
          subtitle: 'Organization, conversation, speech and battery',
          icon: 'settings',
          path: '/settings/general',
          local: true,
          keywords: 'background widgets voice dictation startup time sort confirmations',
        },
        {
          title: 'App & updates',
          subtitle: 'Version, local builds and Live Activities',
          icon: 'settings',
          path: '/settings/updates',
          local: true,
        },
      ],
    },
    {
      title: 'Agents',
      footer: 'Agents, tools and task defaults share the selected scope.',
      items: [
        {
          title: 'Agents',
          subtitle: 'Codex, Claude Code and ready-to-configure profiles',
          icon: 'chat',
          tint: '#bb9aff',
          path: '/settings/agents',
          storage: 'inherited',
          keywords: 'models providers permissions access accounts login reasoning',
        },
        {
          title: 'MCP & skills',
          subtitle: 'Shared tools and project or agent overrides',
          icon: 'jobs',
          tint: '#5ac8bd',
          path: '/settings/resources',
          storage: 'inherited',
          keywords: 'resources integrations servers registry tools',
        },
        {
          title: 'Usage & limits',
          subtitle: 'Provider quotas, agent time and tokens',
          icon: 'jobs',
          tint: '#f3bb75',
          path: '/settings/usage',
          storage: 'computer',
          keywords: 'codex claude costs models',
        },
      ],
    },
    {
      title: 'Tasks & projects',
      items: [
        {
          title: 'Task defaults',
          subtitle: 'Default agent, workspace, lifecycle and saved prompts',
          icon: 'settings',
          path: '/settings/task-defaults',
          storage: 'inherited',
          keywords:
            'inherit global computer project checkout worktree setup submodules quota resume settle restart',
        },
        {
          title: 'Source control',
          subtitle: 'GitHub, Bitbucket, Forgejo, Gitea and Azure DevOps',
          icon: 'changes',
          path: '/settings/source-control',
          storage: 'computer',
          keywords: 'git accounts forge tokens repositories',
        },
        {
          title: 'Automations',
          subtitle: 'Scheduled tasks, workflows and runs',
          icon: 'jobs',
          path: '/settings/automations',
          storage: 'computer',
          keywords: 'jobs cron webhooks',
        },
      ],
    },
    {
      title: 'Computers',
      footer: profiles.length
        ? 'Open a computer for task behavior, PRs & pipelines, artifacts, memory, worktrees and runtime tools.'
        : 'Pair a computer to configure agents and project defaults.',
      items: [
        {
          title: profiles.length ? 'Devices & runtime' : 'Connect a computer',
          label: 'Devices & runtime',
          subtitle: profiles.length
            ? `${profiles.length} saved · ${overviews.filter((entry) => entry.connected).length} online`
            : 'Pair your runtime to get started',
          icon: 'device',
          tint: overviews.some((entry) => entry.connected) ? colors.accent : colors.muted,
          path: '/settings/devices',
          local: true,
          keywords:
            'pair runtime devices network address tailscale netbird shell commands installations accounts titles dictation worktrees logs memory notes artifacts retention experimental pr pull requests pipeline pipelines watcher child agents subagent concurrent limit',
        },
        {
          title: 'Device previews',
          subtitle: 'Remote simulators and phones over SSH',
          icon: 'device',
          path: '/settings/device-hosts',
          storage: 'computer',
          keywords:
            'ssh device hosts simulator emulator ios android iphone install deploy forwarding',
        },
      ],
    },
    {
      title: 'History',
      items: [
        {
          title: 'Archived tasks',
          subtitle: archived
            ? `${archived} archived · Restore from the task menu`
            : 'Nothing archived',
          icon: 'tasks',
          path: '/settings/archived',
          keywords: 'restore history deleted archive',
        },
      ],
    },
  ] as const
  const needle = query.trim().toLowerCase()
  const matches = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const text =
          `${group.title} ${item.title} ${item.subtitle} ${'keywords' in item ? item.keywords : ''}`.toLowerCase()
        return needle.split(/\s+/).every((term) => text.includes(term))
      }),
    }))
    .filter((group) => group.items.length)
  return (
    <SettingsPage>
      <ScreenHeader title="Settings" testID="Settings heading" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: 8, gap: 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <SearchField
          label="Search settings"
          placeholder="Find a setting…"
          value={query}
          onChangeText={setQuery}
        />
        {!needle && crash && (
          <View accessibilityRole="alert" style={[styles.card, { gap: 6 }]}>
            <Text style={[styles.text, { fontWeight: '600' }]}>
              {crash.fatal ? 'The app closed unexpectedly' : 'The app hit an unexpected error'}
            </Text>
            <Text style={styles.muted}>{new Date(crash.at).toLocaleString()}</Text>
            <Text selectable numberOfLines={6} style={styles.muted}>
              {crash.message}
            </Text>
            <Text style={[styles.muted, { fontSize: 12 }]}>
              Nothing was sent anywhere. Your tasks and saved work on your computers are safe.
            </Text>
            <Action
              secondary
              label="Dismiss crash report"
              onPress={() => {
                setCrash(null)
                void clearLastCrash()
              }}
            />
          </View>
        )}
        {!needle && profiles.length > 0 && (
          <SettingsGroup>
            <SettingsRow
              title="Settings scope"
              subtitle={`${target.projectName} · ${target.computerName}`}
              value={settingsScopeLabels[target.scope]}
              icon="stack"
              onPress={() => router.push('/settings/agents')}
              last
            />
          </SettingsGroup>
        )}
        {matches.map((group) => (
          <SettingsGroup
            key={group.title}
            title={group.title}
            footer={!needle && 'footer' in group ? group.footer : undefined}
          >
            {group.items.map((item, index) => (
              <SettingsRow
                key={item.path}
                title={item.title}
                value={
                  item.path === '/settings/devices'
                    ? `${overviews.filter((entry) => entry.connected).length} online`
                    : item.path === '/settings/archived'
                      ? String(archived)
                      : undefined
                }
                icon={item.icon}
                label={'label' in item ? item.label : undefined}
                tint={'tint' in item ? item.tint : undefined}
                mark={'storage' in item ? storage[item.storage] : undefined}
                disabled={!profiles.length && !('local' in item && item.local)}
                onPress={() => router.push(item.path)}
                last={index === group.items.length - 1}
              />
            ))}
          </SettingsGroup>
        ))}
        {!matches.length && (
          <Text accessibilityRole="alert" style={styles.muted}>
            No settings match “{query}”.
          </Text>
        )}
        <Text style={[styles.muted, { textAlign: 'center', fontSize: 12 }]}>
          Dovo Studio {appVersion}
          {appBuild ? ` (${appBuild})` : ''}
          {appChannel ? ` · ${appChannel}` : ''}
        </Text>
      </ScrollView>
    </SettingsPage>
  )
}
