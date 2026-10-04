import { appVersion, appBuild, appChannel } from '../runtime/preferences/app-build'
import { router } from 'expo-router'
import { View, ScrollView } from 'react-native'
import { useApplicationState } from '../runtime/state/application-state'
import { SettingsGroup, SettingsRow } from './settings-group'
import { SearchField } from '../ui/controls/field'
import { Text } from '../ui/content/text'
import { colors, styles } from '../ui/theme'
import { useRuntime } from '../runtime/connection/provider'
import { ScreenHeader } from '../ui/layout/screen-header'

export default function SettingsScreen() {
  const { profiles, overviews } = useRuntime()
  const [query, setQuery] = useApplicationState('')
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
      footer:
        'Global → Computer → Project → Project on computer. Later levels override earlier ones.',
      items: [
        {
          title: 'Agents',
          subtitle: 'Codex, Claude Code and ready-to-configure profiles',
          icon: 'chat',
          tint: '#bb9aff',
          path: '/settings/agents',
          keywords: 'models providers permissions access accounts login reasoning',
        },
        {
          title: 'MCP & skills',
          subtitle: 'Shared tools and project or agent overrides',
          icon: 'jobs',
          tint: '#5ac8bd',
          path: '/settings/resources',
          keywords: 'resources integrations servers registry tools',
        },
        {
          title: 'Usage & limits',
          subtitle: 'Provider quotas, agent time and tokens',
          icon: 'jobs',
          tint: '#f3bb75',
          path: '/settings/usage',
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
          keywords:
            'inherit global computer project checkout worktree setup submodules quota resume settle restart',
        },
        {
          title: 'Source control',
          subtitle: 'GitHub, Bitbucket, Forgejo, Gitea and Azure DevOps',
          icon: 'changes',
          path: '/settings/source-control',
          keywords: 'git accounts forge tokens repositories',
        },
        {
          title: 'Automations',
          subtitle: 'Scheduled tasks, workflows and runs',
          icon: 'jobs',
          path: '/settings/automations',
          keywords: 'jobs cron webhooks',
        },
      ],
    },
    {
      title: 'Computers',
      footer: profiles.length
        ? 'Open a computer for installations, CLI commands, worktrees, computer use and activity.'
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
            'pair runtime devices network address tailscale netbird shell commands installations accounts titles dictation worktrees logs',
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
    <View style={styles.screen}>
      <ScreenHeader title="Settings" testID="Settings heading" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: 8, gap: 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <SearchField
          label="Search settings"
          placeholder="Find a setting…"
          value={query}
          onChangeText={setQuery}
        />
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
                subtitle={item.subtitle}
                icon={item.icon}
                label={'label' in item ? item.label : undefined}
                tint={'tint' in item ? item.tint : undefined}
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
    </View>
  )
}
