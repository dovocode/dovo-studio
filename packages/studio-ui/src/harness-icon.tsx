import { harnessIconData, type TaskHarness } from '@dovo/protocol'
export function HarnessIcon({
  provider,
  className = 'size-3.5',
}: {
  provider: TaskHarness['provider']
  className?: string
}) {
  const data = harnessIconData[provider]
  return (
    <svg
      aria-hidden="true"
      viewBox={data.viewBox}
      className={className}
      fill={data.fill ?? 'currentColor'}
    >
      {data.paths.map((path) => (
        <path key={path.d} d={path.d} opacity={path.opacity} />
      ))}
    </svg>
  )
}
