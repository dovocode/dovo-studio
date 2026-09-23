import { mobileWorkflow } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { View } from 'react-native'
import { responses } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { QuestionForm } from './question-form'
export function TaskQuestions({ taskId }: { taskId: string }) {
  const { snapshot, connected, callEffect } = useRuntime()
  const questions = snapshot?.questions.filter((q) => q.taskId === taskId) ?? []
  const pending = questions.find((q) => q.prompt.blocking !== false) ?? questions[0]
  if (!pending) return null
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingBottom: 8,
      }}
    >
      <QuestionForm
        key={pending.id}
        request={pending}
        connected={connected}
        onAnswer={(answers) => {
          return runClientEffect(
            mobileWorkflow(function* () {
              yield* callEffect(
                '/api/tasks/answer',
                {
                  id: pending.id,
                  answers,
                },
                responses.ok,
              )
            }),
          )
        }}
      />
    </View>
  )
}
