import {
  Bot,
  Code,
  Wrench,
  Shield,
  Bug,
  Search,
  Rocket,
  Terminal,
  Pen,
  Brain,
  FlaskConical,
} from 'lucide-react'
import type { Agent, TaskHarness } from '@dovo/protocol'
import { HarnessIcon } from './harness-icon'
import { cn } from './lib/utils'

export const agentIconChoices = {
  bot: { label: 'Robot', icon: Bot },
  code: { label: 'Code', icon: Code },
  wrench: { label: 'Builder', icon: Wrench },
  shield: { label: 'Shield', icon: Shield },
  bug: { label: 'Bug', icon: Bug },
  search: { label: 'Research', icon: Search },
  rocket: { label: 'Rocket', icon: Rocket },
  terminal: { label: 'Terminal', icon: Terminal },
  pen: { label: 'Writer', icon: Pen },
  brain: { label: 'Brain', icon: Brain },
  flask: { label: 'Experiment', icon: FlaskConical },
} satisfies Record<NonNullable<Agent['icon']>, { label: string; icon: typeof Bot }>

export function AgentAvatar({
  provider,
  customIcon,
  className,
}: {
  provider: TaskHarness['provider']
  customIcon?: Agent['icon']
  className?: string
}) {
  if (!customIcon) return <HarnessIcon provider={provider} className={cn('size-3', className)} />
  const Icon = agentIconChoices[customIcon].icon
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-block size-4 shrink-0 transition-transform duration-200 ease-out motion-safe:hover:scale-105 motion-safe:group-hover/button:scale-105 motion-reduce:transition-none',
        className,
      )}
    >
      <span className="absolute bottom-0 left-0 size-4/5">
        <HarnessIcon provider={provider} className="size-full" />
      </span>
      <span className="absolute right-0 top-0 z-10 size-3/5 rounded-[2px] bg-background ring-1 ring-background">
        <Icon className="size-full" />
      </span>
    </span>
  )
}
