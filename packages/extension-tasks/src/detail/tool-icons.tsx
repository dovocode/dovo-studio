import {
  BookOpen,
  Bot,
  Brain,
  FileCode2,
  Files,
  FolderSymlink,
  GitPullRequest,
  Globe,
  MessagesSquare,
  PanelBottom,
  Plug,
  Shapes,
  Smartphone,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { TaskSurface } from './task-header'

/** One icon per tool, shared by the thread tools rail, pane tabs and tool menus. */
const toolIcons = {
  changes: FileCode2,
  files: Files,
  browser: Globe,
  terminal: PanelBottom,
  'side-chats': MessagesSquare,
  'linked-pulls': GitPullRequest,
  'pull-preview': GitPullRequest,
  agents: Bot,
  projects: FolderSymlink,
  devices: Smartphone,
  artifacts: Shapes,
  'bot-settings': Bot,
  'bot-mcp': Plug,
  'bot-skills': BookOpen,
  'bot-memory': Brain,
  'bot-routines': Workflow,
} satisfies Record<Exclude<TaskSurface, 'chat'>, LucideIcon>

export function RightPaneTabIcon({
  tab,
  size = 13,
  strokeWidth = 1.8,
}: {
  tab: keyof typeof toolIcons
  size?: number
  strokeWidth?: number
}) {
  const Icon = toolIcons[tab]
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" className="shrink-0" />
}
