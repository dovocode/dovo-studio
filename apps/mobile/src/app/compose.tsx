import { Redirect, useIsFocused } from 'expo-router'

/** The tab item opens /new without selecting this route; handle direct links too. */
export default function ComposeRoute() {
  const focused = useIsFocused()
  return focused ? <Redirect href="/new" withAnchor /> : null
}
