import { requireOptionalNativeModule } from 'expo'
import {
  decode,
  mutableStruct,
  minValue,
  maxValue,
  type RuntimeProfile,
  type PendingQuestion,
  type QuestionDraft,
} from '@dovo/protocol'
import { Schema } from 'effect'

type NativeAnswers = {
  configure: (json: string) => Promise<void>
  getDraft: (runtimeId: string, id: string) => Promise<unknown>
  clearDraft: (runtimeId: string, id: string) => Promise<void>
}
const native = requireOptionalNativeModule<NativeAnswers>('DovoQuestionNotifications')
export function isNativeAnswerAction(action: string) {
  return action === 'dovo-reply' || /^dovo-choice-[0-2]$/.test(action)
}
export async function configureNotificationAnswers(profiles: RuntimeProfile[]) {
  if (!native) return false
  await native.configure(
    JSON.stringify(
      Object.fromEntries(
        profiles.map((profile) => [
          profile.id,
          { address: new URL(profile.connection.address).origin, token: profile.connection.token },
        ]),
      ),
    ),
  )
  return true
}
const draftSchema = mutableStruct({
  fieldId: maxValue(minValue(Schema.String, 1), 200),
  value: maxValue(minValue(Schema.String, 1), 10000),
})
export async function notificationAnswerDraft(
  runtimeId: string,
  request: PendingQuestion,
): Promise<Record<string, QuestionDraft> | undefined> {
  const saved = await native?.getDraft(runtimeId, request.id)
  if (!saved) return
  const draft = decode(draftSchema, saved)
  const q = request.prompt.questions.find((q) => q.id === draft.fieldId)
  if (!q || q.secret) return
  if (q.options.some((o) => o.value === draft.value))
    return { [q.id]: { selected: [draft.value], text: '' } }
  if (q.custom) return { [q.id]: { selected: [], text: draft.value } }
}
export async function clearNotificationAnswerDraft(runtimeId: string, id: string) {
  await native?.clearDraft(runtimeId, id)
}
