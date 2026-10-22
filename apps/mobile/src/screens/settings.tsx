import type { IconName } from '../ui/controls/icon'
import { mobileSettingsFields } from './settings-search-data'
import { SettingsScrollView } from './settings-search'
import { appVersion, appBuild, appChannel } from '../runtime/preferences/app-build'
import { router } from 'expo-router'
import { Alert, View } from 'react-native'
import { useApplicationState } from '../runtime/state/application-state'
import { SettingsGroup, SettingsRow } from './settings-group'
import { SettingsSearchField as SearchField } from './settings-controls'
import { Text } from '../ui/content/text'
import { useSettingsTheme as useTheme, SettingsPage } from './settings-theme'
import { useRuntime } from '../runtime/connection/provider'
import { ScreenHeader } from '../ui/layout/screen-header'
import { SettingsAction as Action } from './settings-controls'
import { useEffect } from 'react'
import { clearLastCrash, readLastCrash, type CrashRecord } from '../runtime/diagnostics/crash-log'

const inheritedPages = new Set([
  '/settings/task-defaults',
  '/settings/task-lifecycle',
  '/settings/agents',
  '/settings/resources',
])
function settingsLocation(path: string, local: boolean): { icon: IconName; description: string } {
  if (path === '/settings/devices')
    return {
      icon: 'laptop',
      description:
        'Connections stay on this device. Computer settings are saved on the selected computer and shared with paired devices.',
    }
  if (path === '/settings/usage' || path === '/settings/archived')
    return { icon: 'stack', description: 'Information from your paired computers.' }
  if (local) return { icon: 'device', description: 'Saved automatically on this device.' }
  if (inheritedPages.has(path))
    return {
      icon: 'stack',
      description:
        'Shared defaults → Computer → Project → Project on computer. Choose a target at the top of the page; inheritance icons explain each setting.',
    }
  return {
    icon: 'server',
    description: 'Saved on the computer selected on this page and shared with its paired devices.',
  }
}

export default function SettingsScreen({ categorySlug }: { categorySlug?: string } = {}) {
  const { colors, styles } = useTheme()

  const { profiles, overviews } = useRuntime()
  const [query, setQuery] = useApplicationState('')
  const [crash, setCrash] = useApplicationState<CrashRecord | null>(null)
  useEffect(() => {
    if (categorySlug) return
    let active = true
    void readLastCrash().then((record) => {
      if (active) setCrash(record)
    })
    return () => {
      active = false
    }
  }, [categorySlug, setCrash])
  const online = overviews.filter((entry) => entry.connected).length
  const archived = overviews.reduce(
    (count, entry) =>
      count +
      (entry.snapshot?.workspace.tasks.filter((task) => task.archivedAt && !task.example).length ??
        0),
    0,
  )
  const groups = [
    {
      title: 'App preferences',
      path: '/settings/app-preferences',
      items: [
        {
          title: 'Appearance',
          subtitle: 'Colors, accessibility, density and fonts',
          icon: 'preview',
          path: '/settings/appearance',
          group: 'Look & feel',
          local: true,
          keywords:
            'theme system light dark colors palette display terminal font density code syntax accessibility colorblind color blindness contrast motion animation reduce blue orange',
        },
        {
          title: 'General',
          subtitle: 'Startup page and time format',
          icon: 'settings',
          path: '/settings/general',
          group: 'Look & feel',
          local: true,
          keywords: 'startup launch date time clock format automatic 12-hour 24-hour',
        },
        {
          title: 'Conversation',
          subtitle: 'Files, tool activity and keeping the screen on',
          icon: 'chat',
          path: '/settings/conversation',
          group: 'Chat & voice',
          local: true,
          keywords:
            'collapse changed files tool call details output full inputs commands edits searches collapsed expanded keep screen awake on sleep',
        },
        {
          title: 'Speech & driving',
          subtitle: 'Dictation, read aloud, voices and car mode',
          icon: 'microphone',
          path: '/settings/speech',
          group: 'Chat & voice',
          local: true,
          keywords:
            'speech voice siri language dictation read replies aloud speaking speed driving car',
        },
        {
          title: 'Notifications',
          subtitle: 'Task alerts, computer subscriptions and Live Activities',
          icon: 'settings',
          path: '/settings/notifications',
          group: 'Alerts & background',
          local: true,
          keywords:
            'push alerts completion failed failures input requests lock screen dynamic island managed standalone relay',
        },
        {
          title: 'Battery & background',
          subtitle: 'Computer refresh and widget updates on this device',
          icon: 'settings',
          path: '/settings/battery',
          group: 'Alerts & background',
          local: true,
          keywords:
            'background widgets refresh battery energy network frequency manual 30 seconds 2 minutes',
        },
        {
          title: 'App & updates',
          subtitle: 'Version, releases and installing app updates',
          icon: 'info',
          path: '/settings/updates',
          group: 'About',
          local: true,
          keywords: 'version build testflight google play release install upgrade',
        },
        {
          title: 'Task & PR preferences',
          subtitle: 'Task list, confirmations and merge preferences',
          icon: 'tasks',
          path: '/settings/task-preferences',
          group: 'On this device',
          local: true,
          keywords:
            'sort group working section organization archive stop confirm pull requests draft squash rebase merge',
        },
      ],
    },
    {
      title: 'New task defaults',
      path: '/settings/new-task-defaults',
      items: [
        {
          title: 'Task defaults',
          subtitle: 'Agent, workspace and prompts',
          icon: 'settings',
          path: '/settings/task-defaults',
          group: 'Shared defaults',
          keywords:
            'inherit global computer project checkout worktree setup submodules quota resume settle restart',
        },
      ],
    },
    {
      title: 'Running task behavior',
      path: '/settings/running-task-settings',
      items: [
        {
          title: 'Task lifecycle',
          subtitle: 'Recovery, settling and archiving across scopes',
          icon: 'tasks',
          path: '/settings/task-lifecycle',
          group: 'Task workflow',
          keywords:
            'inherit quota limited resume snooze settle merged closed inactive archive restart lifecycle',
        },
        {
          title: 'Running tasks',
          subtitle: 'Running tasks, child agents, approvals and reviews',
          icon: 'tasks',
          path: '/settings/task-behavior',
          group: 'Task workflow',
          keywords:
            'restart resume interrupted sleep awake auto archive inactive maximum concurrent child agents limit experimental models tune maestro scope project supervised allow web requests approvals code reviews verification',
        },
        {
          title: 'Pull requests & pipelines',
          subtitle: 'PR linking, lifecycle and feedback watchers',
          icon: 'changes',
          path: '/settings/pull-requests',
          group: 'Task workflow',
          keywords:
            'smart linking settle merge closed archive watcher monitoring checks pipeline pr pull requests feedback',
        },
      ],
    },
    {
      title: 'Agents & tools',
      path: '/settings/agent-settings',
      items: [
        {
          title: 'Agents',
          subtitle: 'Codex, Claude Code and agent profiles',
          icon: 'chat',
          tint: '#bb9aff',
          path: '/settings/agents',
          group: 'Agent setup',
          keywords: 'models providers permissions access accounts login reasoning',
        },
        {
          title: 'MCP, skills & hooks',
          subtitle: 'Shared tools and project or agent overrides',
          icon: 'jobs',
          tint: '#5ac8bd',
          path: '/settings/resources',
          group: 'Agent setup',
          keywords: 'resources integrations servers registry tools',
        },
        {
          title: 'Memory',
          subtitle: 'System, General and project notes',
          icon: 'fileText',
          path: '/settings/memory',
          group: 'Knowledge',
          keywords: 'notes memory project system-wide general threads scopes enable disable',
        },
        {
          title: 'Usage & limits',
          subtitle: 'Provider quotas, time and tokens across computers',
          icon: 'jobs',
          tint: '#f3bb75',
          path: '/settings/usage',
          group: 'Usage',
          keywords: 'codex claude costs models tokens quotas accounts all computers',
        },
      ],
    },
    {
      title: 'Tasks & projects',
      path: '/settings/task-settings',
      items: [
        {
          title: 'Worktrees',
          subtitle: 'Branch names and checkout cleanup',
          icon: 'changes',
          path: '/settings/worktrees',
          group: 'Files & outputs',
          keywords:
            'git prefix branch remove delete deleting worktree archived cleanup last thread checkout',
        },
        {
          title: 'Artifacts',
          subtitle: 'Documents, previews and retention',
          icon: 'preview',
          path: '/settings/artifacts',
          group: 'Files & outputs',
          keywords:
            'enable storage retention settled archived documents diagrams code interactive previews versions delete forever days',
        },
        {
          title: 'Source control',
          subtitle: 'Accounts and linked projects across your computers',
          icon: 'changes',
          path: '/settings/source-control',
          group: 'Files & outputs',
          keywords:
            'git accounts forge tokens repositories github bitbucket forgejo gitea azure devops',
        },
        {
          title: 'Automations',
          subtitle: 'Scheduled workflows and runs',
          icon: 'jobs',
          path: '/settings/automations',
          group: 'Task workflow',
          keywords: 'jobs cron webhooks',
        },
      ],
    },
    {
      title: 'Computers',
      path: '/settings/computer-settings',
      footer: profiles.length
        ? undefined
        : 'Pair a computer to configure agents and project defaults.',
      items: [
        {
          title: profiles.length ? 'Manage computers' : 'Connect a computer',
          testID: 'Devices & runtime',
          subtitle: profiles.length
            ? 'Connections, runtime settings, updates and tools'
            : 'Pair your runtime to get started',
          icon: 'device',
          tint: overviews.some((entry) => entry.connected) ? colors.accent : colors.muted,
          path: '/settings/devices',
          group: 'Connections',
          local: true,
          keywords:
            'pair runtime devices network address tailscale netbird shell commands installations accounts titles dictation logs debug',
        },
        {
          title: 'Runtime tools',
          subtitle: 'Studio Tools, linked projects and retrieval',
          icon: 'settings',
          path: '/settings/runtime-tools',
          group: 'Tools & previews',
          keywords:
            'experimental studio tools remote desktop threads automations browsers ui diagnostics linked projects share github jira retrieval preferred computer',
        },
        {
          title: 'Device previews',
          subtitle: 'Simulators and phones over SSH',
          icon: 'device',
          path: '/settings/device-hosts',
          group: 'Tools & previews',
          keywords:
            'ssh device hosts simulator emulator ios android iphone install deploy forwarding',
        },
      ],
    },
    {
      title: 'History',
      path: '/settings/history-settings',
      items: [
        {
          title: 'Activity retention',
          subtitle: 'How long to keep requests and tool details',
          icon: 'history',
          path: '/settings/activity-retention',
          group: 'Storage',
          keywords: 'history retention diagnostics events logs requests activity keep forever days',
        },
        {
          title: 'Archived tasks',
          subtitle: archived
            ? `${archived} archived · Restore from the task menu`
            : 'Nothing archived',
          icon: 'archive',
          path: '/settings/archived',
          group: 'Task history',
          keywords: 'restore history deleted archive',
        },
      ],
    },
  ] as const
  const category = groups.find((group) => group.path === `/settings/${categorySlug}`)
  const needle = query.trim().toLowerCase()
  const matches = (category ? [category] : groups)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const text =
          `${group.title} ${item.group} ${item.title} ${item.subtitle} ${'keywords' in item ? item.keywords : ''} ${(mobileSettingsFields[item.path] ?? []).join(' ')}`.toLowerCase()
        return needle.split(/\s+/).every((term) => text.includes(term))
      }),
    }))
    .filter((group) => group.items.length)
  return (
    <SettingsPage>
      <ScreenHeader title={category?.title ?? 'Settings'} testID="Settings heading" />
      <SettingsScrollView
        contentContainerStyle={[styles.content, { paddingTop: 4, gap: 20 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <SearchField
          label="Search settings"
          placeholder={category ? `Search ${category.title.toLowerCase()}…` : 'Search settings…'}
          value={query}
          onChangeText={setQuery}
        />
        {!category && !needle && crash && (
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
        {matches.map((group) => (
          <SettingsGroup
            key={group.path}
            title={category ? undefined : group.title}
            footer={'footer' in group ? group.footer : undefined}
          >
            {group.items.map((item) => (
              <View key={item.path}>
                <SettingsRow
                  key={item.path}
                  title={item.title}
                  subtitle={item.subtitle}
                  value={
                    item.path === '/settings/devices'
                      ? `${online} online`
                      : item.path === '/settings/archived'
                        ? String(archived)
                        : undefined
                  }
                  icon={item.icon}
                  testID={'testID' in item ? item.testID : undefined}
                  tint={'tint' in item ? item.tint : undefined}
                  disabled={!profiles.length && !('local' in item && item.local)}
                  mark={{
                    icon: settingsLocation(item.path, 'local' in item && item.local).icon,
                    label: `Settings scope for ${item.title}`,
                    onPress: () =>
                      Alert.alert(
                        item.title,
                        settingsLocation(item.path, 'local' in item && item.local).description,
                      ),
                  }}
                  onPress={() => router.push(item.path)}
                />
                {!!needle &&
                  (mobileSettingsFields[item.path] ?? [])
                    .filter((label) =>
                      needle
                        .split(/\s+/)
                        .every((term) => `${label} ${item.title}`.toLowerCase().includes(term)),
                    )
                    .map((label) => (
                      <SettingsRow
                        key={label}
                        title={label}
                        subtitle={item.title}
                        icon="settings"
                        disabled={!profiles.length && !('local' in item && item.local)}
                        onPress={() =>
                          router.push({ pathname: item.path, params: { setting: label } })
                        }
                      />
                    ))}
              </View>
            ))}
          </SettingsGroup>
        ))}
        {needle && <Action secondary label="Clear search" onPress={() => setQuery('')} />}
        {!matches.length && (
          <Text accessibilityRole="alert" style={styles.muted}>
            No settings match “{query}”.
          </Text>
        )}
        {!category && (
          <Text style={[styles.muted, { textAlign: 'center', fontSize: 12 }]}>
            Dovo Studio {appVersion}
            {appBuild ? ` (${appBuild})` : ''}
            {appChannel ? ` · ${appChannel}` : ''}
          </Text>
        )}
      </SettingsScrollView>
    </SettingsPage>
  )
}
