import { qualityCases, qualityCoreIds } from './tool-quality-round.mjs'

// Freeze this plan before round 37. Round 38 repeats the same cases after review.
// Later rounds cover the rest of the tool catalog without replacing matched scores.
const transfer = qualityCases.filter((test) => !qualityCoreIds.includes(test.id))
export const reviewedToolRounds = {
  37: [...qualityCoreIds],
  38: [...qualityCoreIds],
  39: transfer.slice(0, 10).map((test) => test.id),
  40: transfer.slice(10, 20).map((test) => test.id),
  41: transfer.slice(20).map((test) => test.id),
}
export { qualityCases as reviewedToolCases }
