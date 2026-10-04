import { runtimeComputerName } from '@dovo/protocol'
import { mobileWorkflow } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { router } from 'expo-router'
import { Action } from '../../ui/controls/action'
import { View } from 'react-native'
import { responses } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { styles } from '../../ui/theme'
import { QuestionForm } from '../composer/question-form'
export function TaskQuestions({ taskId, questionId }: { taskId: string; questionId?: string }) {
  const { snapshot, profile, connected, callEffect } = useRuntime()
  const questions = snapshot?.questions.filter((q) => q.taskId === taskId) ?? []
  const pending = questionId
    ? questions.find((q) => q.id === questionId)
    : (questions.find((q) => q.prompt.blocking !== false) ?? questions[0])
  const task = snapshot?.workspace.tasks.find((task) => task.id === taskId)
  const project = snapshot?.workspace.repositories.find(
    (repo) => repo.id === task?.repositoryId,
  )?.name
  if (questionId && !pending)
    return (
      <View style={{ padding: 16, gap: 8 }}>
        <Text accessibilityRole="alert" style={styles.muted}>
          {connected
            ? 'This question has already been answered or is no longer pending.'
            : 'Reconnect to check this question.'}
        </Text>
        <Action
          label="Show pending questions"
          secondary
          onPress={() => router.setParams({ questionId: undefined })}
        />
      </View>
    )
  if (!pending) return null
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingBottom: 8,
      }}
    >
      <Text style={styles.muted}>
        {[task?.title, runtimeComputerName({ profile, snapshot }), project]
          .filter(Boolean)
          .join(' · ')}
      </Text>
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
