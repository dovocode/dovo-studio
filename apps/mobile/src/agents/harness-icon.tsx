import { harnessIconData, type TaskHarness } from '@dovo/protocol'
import Svg, { Path } from 'react-native-svg'
import { colors } from '../ui/theme'
export function HarnessIcon({
  provider,
  size = 14,
}: {
  provider: TaskHarness['provider']
  size?: number
}) {
  const data = harnessIconData[provider]
  return (
    <Svg
      width={size}
      height={size}
      viewBox={data.viewBox}
      fill={data.fill ?? colors.muted}
      accessible={false}
    >
      {data.paths.map((path) => (
        <Path key={path.d} d={path.d} opacity={path.opacity} />
      ))}
    </Svg>
  )
}
