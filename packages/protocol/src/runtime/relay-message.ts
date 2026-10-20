import { Schema } from 'effect'
import { relayNotificationSchema } from './push-notifications.js'
import { relayLiveActivitySchema } from './previews/live-activities.js'
export const relayMessageSchema = Schema.Union([relayLiveActivitySchema, relayNotificationSchema])
export type RelayMessage = typeof relayMessageSchema.Type
