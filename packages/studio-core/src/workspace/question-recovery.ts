import { useEffect, useSyncExternalStore } from 'react'
import { createQuestionRecovery, runtimeRecoveryScope } from '@dovo/protocol'
import { useWorkspace } from './context'
export const questionRecovery = createQuestionRecovery({
  getAllKeys: () => Object.keys(localStorage),
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
})
export function useQuestionRecovery() {
  const { connection } = useWorkspace()
  const scope = runtimeRecoveryScope(connection)
  useSyncExternalStore(questionRecovery.subscribe, () => questionRecovery.version(scope))
  useEffect(() => {
    void questionRecovery.load(scope)
  }, [scope])
  return { scope, store: questionRecovery }
}
