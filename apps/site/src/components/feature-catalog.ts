import { repository } from './site-links'

const doc = (path: string) => `${repository}/blob/main/docs/${path}.md`

export const agentProviders = [
  'Codex',
  'Claude',
  'OpenCode',
  'Cursor',
  'GitHub Copilot',
  'Hermes',
  'Grok Build',
  'Muse Code',
  'Mistral Vibe',
  'ACP agents',
] as const

export const featureCatalog = [
  {
    id: 'browser',
    category: 'PREVIEW',
    title: 'See what your agent is building.',
    description:
      'Open a browser on the runtime host. Inspect and interact with your running app from desktop, web or a paired phone, without exposing its development port.',
    detail: 'Host browser',
    guide: doc('design/browser-and-devices'),
    link: 'Explore browser previews',
  },
  {
    id: 'devices',
    category: 'DEVICE HUB',
    title: 'Take the work to a real device.',
    description:
      'Discover simulators and physical iOS and Android devices, install builds, capture screenshots and test interactions on local or configured remote hosts.',
    detail: 'Optional · off by default',
    guide: doc('design/browser-and-devices') + '#physical-iphones-and-android-phones',
    link: 'Set up Device Hub',
  },
  {
    id: 'artifacts',
    category: 'ARTIFACTS',
    title: 'Give the answer a useful form.',
    description:
      'Keep documents, interactive HTML, graphics and code beside the conversation. Revisit saved versions, browse the artifact library and export a version to PDF.',
    detail: 'Optional · off by default',
    guide: doc('artifacts'),
    link: 'Explore artifacts',
  },
  {
    id: 'memory',
    category: 'MEMORY',
    title: 'Keep the decisions that matter.',
    description:
      'Share explicitly saved notes across threads. Enable project, system-wide or projectless memory separately, and inspect, edit or delete what is remembered.',
    detail: 'Opt in per scope · stored on the runtime',
    guide: doc('memory'),
    link: 'Learn about memory',
  },
  {
    id: 'integrations',
    category: 'ISSUES & REVIEW',
    title: 'From an issue to a reviewed change.',
    description:
      'Start task drafts from issues, investigate pipeline runs and review pull requests. Connect GitHub, GitLab, Bitbucket, Azure DevOps, Forgejo, Gitea or Jira as supported by each integration.',
    detail: 'Actions vary by provider',
    guide: doc('issues-pipelines-jira'),
    link: 'Connect your workflow',
  },
  {
    id: 'usage',
    category: 'USAGE & LIMITS',
    title: 'Know where the work is going.',
    description:
      'Compare reported tokens, API-equivalent cost estimates and supported account limits across connected computers. Missing data stays visible; estimates are separate from your subscription bill.',
    detail: 'Provider-reported usage',
    guide: doc('usage'),
    link: 'Understand usage & limits',
  },
  {
    id: 'subagents',
    category: 'CHILD AGENTS',
    title: 'Bring another agent into the task.',
    description:
      'When you allow delegation, agents can launch children on another supported harness or use a saved configuration. Follow their work, questions and results in the parent thread.',
    detail: 'Shared checkout · inherited permissions',
    guide: doc('cross-harness-subagents'),
    link: 'Explore child agents',
  },
  {
    id: 'studio-tools',
    category: 'STUDIO TOOLS',
    title: 'Let agents work with Studio itself.',
    description:
      'Selectively enable tools for threads, automations, browser sessions and diagnostics, including paired computers. Live Studio UI interaction stays local, and human review gates stay in your hands.',
    detail: 'Experimental · off by default',
    guide: doc('studio-tools'),
    link: 'Configure Studio Tools',
  },
] as const
