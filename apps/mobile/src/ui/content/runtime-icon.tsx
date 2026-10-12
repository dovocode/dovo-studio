import type { RuntimeIcon as RuntimeIconName } from '@dovo/protocol'
import { Icon, type IconName } from '../controls/icon'
import type { ComponentProps } from 'react'
const icons = {
  desktop: 'device',
  laptop: 'laptop',
  server: 'server',
  cloud: 'cloud',
  cpu: 'cpu',
  terminal: 'terminal',
} satisfies Record<RuntimeIconName, IconName>
export const runtimeIconName = (icon: RuntimeIconName = 'desktop'): IconName => icons[icon]
export function RuntimeIcon({
  icon,
  ...props
}: Omit<ComponentProps<typeof Icon>, 'name'> & { icon?: RuntimeIconName }) {
  return <Icon name={runtimeIconName(icon)} {...props} />
}
