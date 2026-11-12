// Standalone native regression entry. Use test answers only; it does not contact a runtime.
import { registerRootComponent } from 'expo'
import { getRandomValues } from 'expo-crypto'
import { RegistryProvider } from '@effect/atom-react'
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { View, Text, TextInput, Button, SafeAreaView } from 'react-native'
import {
  decode,
  questionPromptSchema,
  createQuestionRecovery,
  configureSharingRandom,
} from '@dovo/protocol'
import { QuestionForm } from '../src/tasks/composer/question-form'
import { createNotificationViewport } from '../src/notifications/viewport'
import { NotificationViewportContext } from '../src/notifications/viewport-view'
const prompt = decode(questionPromptSchema, {
  title: 'Native question QA',
  blocking: false,
  questions: [
    {
      id: 'choice',
      header: 'Approach',
      question: 'Choose a test answer',
      custom: true,
      options: [
        { value: 'small', label: 'Small change' },
        { value: 'large', label: 'Large change' },
      ],
    },
  ],
})
configureSharingRandom((bytes) => getRandomValues(bytes))
const recovery = createQuestionRecovery(AsyncStorage)
function App() {
  useSyncExternalStore(recovery.subscribe, () => recovery.version('qa'))
  useEffect(() => {
    void recovery.load('qa')
  }, [])
  const [version, setVersion] = useState(0)
  const [visible, setVisible] = useState(true)
  const [result, setResult] = useState('Ready')
  const [failure, setFailure] = useState(false)
  const view = useRef<ComponentRef<typeof View>>(null)
  const [viewport] = useState(() =>
    createNotificationViewport((callback) =>
      view.current?.measureInWindow((x, y, width, height) => callback({ x, y, width, height })),
    ),
  )
  const request = { id: 'qa-' + version, taskId: 'native-qa', prompt, createdAt: '' }
  return (
    <RegistryProvider>
      <SafeAreaView style={{ flex: 1 }}>
        <NotificationViewportContext.Provider value={viewport}>
          <View
            ref={view}
            collapsable={false}
            style={{ flex: 1, padding: 20, justifyContent: 'flex-end' }}
          >
            <Text accessibilityLabel="Result">{result}</Text>
            <Text>{recovery.error('qa')}</Text>
            <Button
              title="Reset question"
              onPress={() => {
                setVersion((v) => v + 1)
                setVisible(true)
                setResult('Ready')
              }}
            />
            <Button
              title={failure ? 'Use success' : 'Use failure'}
              onPress={() => setFailure((v) => !v)}
            />
            {visible && (
              <QuestionForm
                key={version}
                request={request}
                savedDrafts={
                  recovery.entries('qa').find((entry) => entry.request.id === request.id)?.drafts
                }
                onDraftsChange={(drafts) => recovery.update('qa', request, drafts)}
                connected
                runtimeId="qa-runtime"
                notificationAccessible
                onAnswer={async (answers) => {
                  if (failure) throw Error('QA connection failed')
                  setVisible(false)
                  await new Promise((resolve) => setTimeout(resolve, 400))
                  setResult(answers ? 'Answer received' : 'Declined')
                }}
                onAnswered={() => setResult('Answer complete')}
              />
            )}
            <TextInput
              accessibilityLabel="Composer draft"
              defaultValue="Keep this draft"
              style={{ borderWidth: 1, minHeight: 44 }}
            />
          </View>
        </NotificationViewportContext.Provider>
      </SafeAreaView>
    </RegistryProvider>
  )
}
registerRootComponent(App)
