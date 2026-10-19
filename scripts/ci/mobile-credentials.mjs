import { chmodSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'

const platform = process.argv[2]
if (!['ios', 'android'].includes(platform)) throw new Error('Expected ios or android')
const directory = join(process.env.RUNNER_TEMP, 'dovo-mobile-credentials')
mkdirSync(directory, { mode: 0o700 })
const required = (key) => {
  const value = process.env[key]
  if (!value) throw new Error(`Missing ${key}`)
  return value
}
const save = (name, data) => {
  const path = join(directory, name)
  writeFileSync(path, data, { mode: 0o600 })
  return path
}
const environment = (key, value) => {
  if (value.includes('\n') || value.includes('\r')) throw new Error(`Invalid ${key}`)
  appendFileSync(required('GITHUB_ENV'), `${key}=${value}\n`)
}
if (platform === 'android') {
  for (const key of [
    'MOBILE_ANDROID_STORE_PASSWORD',
    'MOBILE_ANDROID_KEY_ALIAS',
    'MOBILE_ANDROID_KEY_PASSWORD',
  ])
    required(key)
  const keystore = save(
    'upload.keystore',
    Buffer.from(required('MOBILE_ANDROID_KEYSTORE'), 'base64'),
  )
  const services = Buffer.from(required('MOBILE_GOOGLE_SERVICES'), 'base64')
  JSON.parse(services.toString('utf8'))
  environment('DOVO_ANDROID_KEYSTORE', keystore)
  environment('DOVO_GOOGLE_SERVICES_FILE', save('google-services.json', services))
} else {
  const team = required('DOVO_APPLE_TEAM_ID')
  if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error('Invalid Apple team')
  const certificate = save(
    'distribution.p12',
    Buffer.from(required('MOBILE_IOS_CERTIFICATE'), 'base64'),
  )
  const keychain = join(directory, 'build.keychain-db')
  const password = randomBytes(32).toString('hex')
  const security = (args) => {
    try {
      return execFileSync('security', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      throw new Error(
        `Apple signing setup failed during ${args[0]}; verify the private certificate, password and profiles`,
      )
    }
  }
  security(['create-keychain', '-p', password, keychain])
  security(['set-keychain-settings', '-lut', '21600', keychain])
  security(['unlock-keychain', '-p', password, keychain])
  security([
    'import',
    certificate,
    '-P',
    required('MOBILE_IOS_CERTIFICATE_PASSWORD'),
    '-k',
    keychain,
    '-t',
    'agg',
    '-T',
    '/usr/bin/codesign',
    '-T',
    '/usr/bin/security',
  ])
  security([
    'set-key-partition-list',
    '-S',
    'apple-tool:,apple:,codesign:',
    '-s',
    '-k',
    password,
    keychain,
  ])
  // The runner is disposable; leave its login keychain available alongside this dedicated keychain.
  security([
    'list-keychains',
    '-d',
    'user',
    '-s',
    keychain,
    join(homedir(), 'Library/Keychains/login.keychain-db'),
  ])
  const profiles = JSON.parse(
    gunzipSync(Buffer.from(required('MOBILE_IOS_PROFILES_GZIP'), 'base64')).toString('utf8'),
  )
  const mapping = {}
  const bundles = [
    'com.dovo.studio',
    'com.dovo.studio.expo-sharing-extension',
    'com.dovo.studio.ExpoWidgetsTarget',
  ]
  for (const bundle of bundles) {
    if (typeof profiles[bundle] !== 'string') throw new Error(`Missing profile for ${bundle}`)
    const path = save(`${bundle}.mobileprovision`, Buffer.from(profiles[bundle], 'base64'))
    const decoded = security(['cms', '-D', '-i', path])
    const checked = execFileSync(
      'python3',
      [
        '-c',
        `
import sys,plistlib,json,datetime
p=plistlib.loads(sys.stdin.buffer.read()); e=p['Entitlements']
assert p['TeamIdentifier']==[sys.argv[1]], 'Wrong profile team'
assert e['application-identifier']==sys.argv[1]+'.'+sys.argv[2], 'Wrong profile app'
assert not e.get('get-task-allow',False), 'Development profile is not accepted'
assert not p.get('ProvisionedDevices') and not p.get('ProvisionsAllDevices'), 'App Store profile required'
assert p['ExpirationDate']>datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), 'Expired profile'
if sys.argv[2]=='com.dovo.studio': assert e.get('aps-environment')=='production', 'Production APNs required'
print(json.dumps({'uuid':p['UUID']}))
`,
        team,
        bundle,
      ],
      { input: decoded, encoding: 'utf8' },
    )
    const { uuid } = JSON.parse(checked)
    if (!/^[A-Fa-f0-9-]{36}$/.test(uuid)) throw new Error('Invalid provisioning UUID')
    mapping[bundle] = uuid
    for (const folder of [
      'Library/MobileDevice/Provisioning Profiles',
      'Library/Developer/Xcode/UserData/Provisioning Profiles',
    ]) {
      const destination = join(homedir(), folder)
      mkdirSync(destination, { recursive: true, mode: 0o700 })
      writeFileSync(
        join(destination, `${uuid}.mobileprovision`),
        Buffer.from(profiles[bundle], 'base64'),
        { mode: 0o600 },
      )
    }
  }
  chmodSync(directory, 0o700)
  environment('DOVO_IOS_PROVISIONING_PROFILES', JSON.stringify(mapping))
  environment('DOVO_MOBILE_KEYCHAIN', keychain)
}
