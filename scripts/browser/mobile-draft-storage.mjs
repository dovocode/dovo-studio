import assert from 'node:assert/strict'

export const mobileDraftStorage = {
  path: '@react-native-async-storage/async-storage',
  contents: `const records = new Map();
export default {
  getItem: async key => records.get(key) ?? null,
  setItem: async (key, value) => { records.set(key, value); },
  removeItem: async key => { records.delete(key); },
};`,
}

export async function waitForMobileDraft(page) {
  await page.waitForFunction(() => window.actions?.draft.ready || window.actions?.draft.error)
  const error = await page.evaluate(() => window.actions.draft.error)
  assert.ok(!error, error)
}
