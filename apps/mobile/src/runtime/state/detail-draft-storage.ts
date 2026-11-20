import AsyncStorage from '@react-native-async-storage/async-storage'
import type { DetailDraftStorage } from './detail-drafts'

/** Unsent editor text stays in app storage, the same place as thread composer drafts. */
export const detailDraftStorage: DetailDraftStorage = AsyncStorage
