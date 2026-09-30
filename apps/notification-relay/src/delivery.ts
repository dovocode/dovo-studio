import { Apns, apnsConfig } from '@dovo/push'
import type { RelayNotification } from '@dovo/protocol'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'

export type DeliveryResult = { delivered: boolean; invalidToken: boolean }
export function createDelivery(env = process.env) {
  const config = apnsConfig(env)
  const apple = config
    ? {
        sandbox: new Apns({ ...config, production: false }),
        production: new Apns({ ...config, production: true }),
      }
    : undefined
  const firebase =
    env.GOOGLE_APPLICATION_CREDENTIALS || env.DOVO_FCM_PROJECT_ID
      ? getMessaging(
          initializeApp({ credential: applicationDefault(), projectId: env.DOVO_FCM_PROJECT_ID }),
        )
      : undefined
  return {
    platforms: { ios: !!apple, android: !!firebase },
    async send(value: RelayNotification): Promise<DeliveryResult> {
      if (value.platform === 'ios') {
        if (!apple) throw new Error('Apple push is not configured on this relay')
        const result = await apple[value.environment].sendAlert(
          value.token,
          {
            aps: {
              alert: { title: value.title, body: value.body },
              sound: 'default',
              'thread-id': `${value.data.runtimeId}:${value.data.taskId}`,
            },
            ...value.data,
          },
          value.id,
        )
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
        await firebase.send({
          token: value.token,
          notification: { title: value.title, body: value.body },
          data: { ...value.data, notificationId: value.id },
          android: {
            priority: 'high',
            ttl: 3_600_000,
            notification: { channelId: 'dovo-tasks', tag: value.id, sound: 'default' },
          },
        })
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
