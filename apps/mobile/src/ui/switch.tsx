import { Switch as NativeSwitch, View, type SwitchProps } from 'react-native'

/** iOS 26+ draws the larger glass switch at the top of the box React Native lays out, so rows
 * using `alignItems: 'center'` showed it above its label. The wrapper fills the row's height and
 * centers the switch inside it. */
export function Switch(props: SwitchProps) {
  return (
    <View style={{ alignSelf: 'stretch', justifyContent: 'center' }}>
      <NativeSwitch {...props} />
    </View>
  )
}
