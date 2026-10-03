import { Redirect, useLocalSearchParams } from 'expo-router'
import { automationHref } from '../../../../shell/source-route'
export default function LegacyAutomationRoute() {
  const { runtimeId, automationId } = useLocalSearchParams<{
    runtimeId: string
    automationId: string
  }>()
  return <Redirect href={automationHref(runtimeId, automationId)} />
}
