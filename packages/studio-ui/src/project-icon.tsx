import { projectIcon, projectIconColor, type Repository } from '@dovo/protocol'
import { cn } from './lib/utils'

export function ProjectIcon({
  repository,
  className,
}: {
  repository?: Repository
  className?: string
}) {
  const icon = projectIcon(repository)
  return (
    <span
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded text-[9px] font-bold uppercase',
        className,
      )}
      style={icon ? undefined : { backgroundColor: projectIconColor(repository), color: '#fff' }}
      aria-hidden="true"
    >
      {icon ? (
        <img src={icon} alt="" className="size-full object-contain" />
      ) : (
        (repository?.name ?? 'P').slice(0, 2)
      )}
    </span>
  )
}
