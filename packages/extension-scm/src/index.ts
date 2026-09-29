import { defineStudioExtension } from '@dovo/studio-core'
export const scmExtension = defineStudioExtension(
  { id: 'dovo.scm', name: 'SCM', version: '0.1.0' },
  [
    {
      id: 'issues',
      title: 'Issues',
      icon: 'issues',
      order: 1.4,
      load: () => import('./work/work-view'),
    },
    {
      id: 'jira',
      title: 'Jira',
      icon: 'jira',
      order: 1.45,
      load: () => import('./work/jira-view'),
    },
    {
      id: 'pipelines',
      title: 'Pipelines',
      icon: 'pipelines',
      order: 1.7,
      navigationGroup: 'hidden',
      load: () => import('./work/pipelines-view'),
    },
    {
      id: 'source-control',
      title: 'Source control',
      icon: 'pulls',
      order: 3,
      navigationGroup: 'settings',
      settingsSection: 'coding',
      keywords: 'github gitlab bitbucket azure forgejo gitea jira accounts forges pull requests',
      load: () => import('./connections/forge-settings'),
    },
    {
      id: 'pulls',
      title: 'Pull requests',
      icon: 'pulls',
      order: 1.5,
      load: () => import('./pulls/list/view'),
    },
  ],
)
