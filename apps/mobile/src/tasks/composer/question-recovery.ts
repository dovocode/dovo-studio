import { useEffect, useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createQuestionRecovery, runtimeRecoveryScope } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
export const questionRecovery = createQuestionRecovery(AsyncStorage)
export function useQuestionRecovery() {
  const { profile } = useRuntime()
  const scope = runtimeRecoveryScope(profile?.connection)
  useSyncExternalStore(questionRecovery.subscribe, () => questionRecovery.version(scope))
  useEffect(() => {
    void questionRecovery.load(scope)
  }, [scope])
  return { scope, store: questionRecovery }
}
