import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Run after all Expo plugins have generated their targets; mod ordering can precede extensions.
const mobile = resolve(process.argv[2] || 'apps/mobile')
const require = createRequire(join(mobile, 'package.json'))
const { IOSConfig } = require('expo/config-plugins')
const profiles = JSON.parse(process.env.DOVO_IOS_PROVISIONING_PROFILES || 'null')
const team = process.env.DOVO_APPLE_TEAM_ID
if (
  !profiles ||
  typeof profiles !== 'object' ||
  Array.isArray(profiles) ||
  !/^[A-Z0-9]{10}$/.test(team || '')
)
  throw new Error('Invalid iOS signing configuration')
const project = IOSConfig.XcodeUtils.getPbxproj(mobile)
const seen = new Set()
for (const entry of Object.values(project.pbxXCBuildConfigurationSection())) {
  if (!entry || typeof entry !== 'object' || !('buildSettings' in entry)) continue
  const settings = entry.buildSettings
  if (!settings || typeof settings !== 'object' || !('PRODUCT_BUNDLE_IDENTIFIER' in settings))
    continue
  const identifier = settings.PRODUCT_BUNDLE_IDENTIFIER
  if (typeof identifier !== 'string') continue
  const bundle = identifier.replace(/^"|"$/g, '')
  if (!bundle.startsWith('com.dovo.studio')) continue
  const uuid = profiles[bundle]
  if (typeof uuid !== 'string' || !/^[A-Fa-f0-9-]{36}$/.test(uuid))
    throw new Error(`Missing distribution profile for ${bundle}`)
  Object.assign(settings, {
    CODE_SIGN_STYLE: 'Manual',
    CODE_SIGN_IDENTITY: '"Apple Distribution"',
    PROVISIONING_PROFILE_SPECIFIER: `"${uuid}"`,
    DEVELOPMENT_TEAM: team,
  })
  seen.add(bundle)
}
for (const bundle of Object.keys(profiles))
  if (!seen.has(bundle)) throw new Error(`Distribution profile has no generated target: ${bundle}`)
writeFileSync(project.filepath, project.writeSync())
