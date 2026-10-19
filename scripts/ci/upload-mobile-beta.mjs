import { createReadStream, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { google } from 'googleapis'

async function upload() {
  const [platform, artifact] = process.argv.slice(2)
  if (!artifact || !['ios', 'android'].includes(platform))
    throw new Error('Expected platform and signed artifact')
  if (platform === 'ios') {
    if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD)
      throw new Error('Missing Apple upload credentials')
    // Upload only: TestFlight processing, external review and public-link distribution remain Apple gates.
    execFileSync(
      'xcrun',
      [
        'altool',
        '--upload-app',
        '--type',
        'ios',
        '--file',
        artifact,
        '--username',
        process.env.APPLE_ID,
        '--password',
        '@env:APPLE_APP_SPECIFIC_PASSWORD',
      ],
      { stdio: 'inherit' },
    )
  } else {
    if (!process.env.MOBILE_PLAY_SERVICE_ACCOUNT)
      throw new Error('Missing dedicated Play Publisher credential')
    const credentials = JSON.parse(process.env.MOBILE_PLAY_SERVICE_ACCOUNT)
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    })
    const publisher = google.androidpublisher({ version: 'v3', auth })
    const packageName = 'com.dovo.studio'
    const track = process.env.MOBILE_PLAY_TRACK || 'beta'
    if (!['internal', 'alpha', 'beta'].includes(track))
      throw new Error('A testing track is required; production upload is disabled')
    const { data: edit } = await publisher.edits.insert({ packageName })
    if (!edit.id) throw new Error('Google Play did not return an edit')
    let committed = false
    try {
      const { data: bundle } = await publisher.edits.bundles.upload({
        packageName,
        editId: edit.id,
        media: { mimeType: 'application/octet-stream', body: createReadStream(artifact) },
      })
      if (
        !bundle.versionCode ||
        String(bundle.versionCode) !== process.env.DOVO_MOBILE_BUILD_NUMBER
      )
        throw new Error('Google Play bundle version does not match the requested nightly build')
      await publisher.edits.tracks.update({
        packageName,
        editId: edit.id,
        track,
        requestBody: {
          releases: [
            {
              name: `Dovo nightly ${process.env.DOVO_MOBILE_BUILD_NUMBER}`,
              versionCodes: [String(bundle.versionCode)],
              status: process.env.MOBILE_BETA_DISTRIBUTION_READY === 'true' ? 'completed' : 'draft',
              releaseNotes: [
                {
                  language: 'en-US',
                  text: 'Nightly development build. Includes current fixes and improvements; please report issues to info@dovocode.com.',
                },
              ],
            },
          ],
        },
      })
      await publisher.edits.validate({ packageName, editId: edit.id })
      await publisher.edits.commit({ packageName, editId: edit.id })
      committed = true
    } finally {
      if (!committed) await publisher.edits.delete({ packageName, editId: edit.id })
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n${platform}: signed nightly uploaded. Store processing/review and beta enrollment are separate from upload.\n`,
    )
}

try {
  await upload()
} catch (error) {
  // SDK errors can include request configs; log the message without credentials or headers.
  let message = error instanceof Error ? error.message : 'Mobile beta upload failed'
  const secrets = [process.env.APPLE_APP_SPECIFIC_PASSWORD, process.env.MOBILE_PLAY_SERVICE_ACCOUNT]
  if (process.env.MOBILE_PLAY_SERVICE_ACCOUNT) {
    try {
      secrets.push(JSON.parse(process.env.MOBILE_PLAY_SERVICE_ACCOUNT).private_key)
    } catch {
      /* The original parse failure is reported below. */
    }
  }
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, '[redacted]')
  console.error(message)
  process.exitCode = 1
}
