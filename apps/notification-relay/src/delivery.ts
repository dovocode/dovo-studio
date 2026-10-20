import { Apns, apnsConfig } from '@dovo/push'
import {
  activityPayload,
  parseNotificationQuestion,
  notificationQuestionCategory,
  type RelayMessage,
  type RelayNotification,
} from '@dovo/protocol'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'

export type DeliveryResult = { delivered: boolean; invalidToken: boolean }
export function appleNotificationPayload(value: RelayNotification) {
  const question = parseNotificationQuestion(value.data)
  return {
    aps: {
      alert: {
        title: value.title,
        body: value.body,
        ...(value.data.project ? { subtitle: value.data.project } : {}),
      },
      sound: 'default',
      ...(value.data.kind === 'input' && value.data.inputType === 'question'
        ? { category: question ? notificationQuestionCategory(question) : 'dovo-question' }
        : {}),
      'thread-id': `${value.data.runtimeId}:${value.data.taskId}`,
    },
    ...value.data,
  }
}
export function androidNotificationPayload(value: RelayNotification) {
  const question = parseNotificationQuestion(value.data)
  return {
    token: value.token,
    ...(question ? {} : { notification: { title: value.title, body: value.body } }),
    data: Object.fromEntries(
      Object.entries({
        ...value.data,
        notificationId: value.id,
        ...(question ? { title: value.title, message: value.body } : {}),
      }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
    android: {
      priority: 'high' as const,
      ttl: 3_600_000,
      ...(question
        ? {}
        : { notification: { channelId: 'dovo-tasks', tag: value.id, sound: 'default' } }),
    },
  }
}
export function createDelivery(env = process.env) {
  const sandbox = apnsConfig(env, 'sandbox')
  const production = apnsConfig(env, 'production')
  const apple = {
    sandbox: sandbox ? new Apns(sandbox) : undefined,
    production: production ? new Apns(production) : undefined,
  }
  const firebase =
    env.GOOGLE_APPLICATION_CREDENTIALS || env.DOVO_FCM_PROJECT_ID
      ? getMessaging(
          initializeApp({ credential: applicationDefault(), projectId: env.DOVO_FCM_PROJECT_ID }),
        )
      : undefined
  return {
    platforms: { ios: !!(apple.sandbox || apple.production), android: !!firebase },
    async send(value: RelayMessage): Promise<DeliveryResult> {
      if (value.platform === 'ios') {
        const provider = apple[value.environment]
        if (!provider)
          throw new Error(`Apple ${value.environment} push is not configured on this relay`)
        const result =
          'kind' in value
            ? await provider.sendLiveActivity(
                value.token,
                activityPayload(value.props, value.event === 'end', value.timestamp * 1000),
                value.id,
              )
            : await provider.sendAlert(value.token, appleNotificationPayload(value), value.id)
        if (result.status === 200) return { delivered: true, invalidToken: false }
        if (
          result.status === 410 ||
          result.reason === 'BadDeviceToken' ||
          result.reason === 'DeviceTokenNotForTopic'
        )
          return { delivered: false, invalidToken: true }
        throw new Error('Apple rejected the notification; check relay credentials')
      }
      if (!firebase) throw new Error('Firebase push is not configured on this relay')
      try {
        await firebase.send(androidNotificationPayload(value))
        return { delivered: true, invalidToken: false }
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          (error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token')
        )
          return { delivered: false, invalidToken: true }
        throw new Error('Firebase delivery failed; check relay credentials and connectivity')
      }
    },
  }
}
