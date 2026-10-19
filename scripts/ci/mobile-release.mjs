import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function mobileBuildNumber(base, run, attempt) {
  const values = [base, run, attempt].map(Number)
  if (!values.every(Number.isSafeInteger) || values.some((value) => value < 1) || values[2] > 99)
    throw new Error('Invalid mobile build sequence')
  const number = values[0] + values[1] * 100 + values[2]
  if (number > 2_100_000_000) throw new Error('Mobile build number exceeds the store limit')
  return String(number)
}
export function validateNightlyTag(tag, version) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) throw new Error('Invalid mobile version')
  if (tag && !new RegExp(`^v${version.replaceAll('.', '\\.')}-nightly\\.[0-9]+$`).test(tag))
    throw new Error('Mobile builds can attach only to a matching nightly release')
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {
    GITHUB_OUTPUT,
    MOBILE_BUILD_NUMBER_BASE = '2026101902',
    GITHUB_RUN_NUMBER,
    GITHUB_RUN_ATTEMPT,
  } = process.env
  const build = mobileBuildNumber(MOBILE_BUILD_NUMBER_BASE, GITHUB_RUN_NUMBER, GITHUB_RUN_ATTEMPT)
  if (!GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
  appendFileSync(GITHUB_OUTPUT, `build=${build}\n`)
}
