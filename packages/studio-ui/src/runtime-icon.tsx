import { Monitor, Laptop, Server, Cloud, Cpu, SquareTerminal } from 'lucide-react'
import type { ComponentProps } from 'react'
import type { RuntimeIcon as RuntimeIconName } from '@dovo/protocol'
const icons = {
  desktop: Monitor,
  laptop: Laptop,
  server: Server,
  cloud: Cloud,
  cpu: Cpu,
  terminal: SquareTerminal,
} satisfies Record<RuntimeIconName, typeof Monitor>
export function RuntimeIcon({
  icon = 'desktop',
  ...props
}: ComponentProps<typeof Monitor> & { icon?: RuntimeIconName }) {
  const Icon = icons[icon]
  return <Icon data-runtime-icon={icon} {...props} />
}
