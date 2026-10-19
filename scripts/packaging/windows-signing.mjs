import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// Reuse the module installed by azure/artifact-signing-action. electron-builder's
// Azure adapter still invokes the retired Invoke-TrustedSigning command.
const artifactSigningCommand = `
$ErrorActionPreference = 'Stop'
Import-Module ArtifactSigning -MinimumVersion 0.1.8 -ErrorAction Stop
$parameters = $env:DOVO_ARTIFACT_SIGNING_REQUEST | ConvertFrom-Json -AsHashtable
Invoke-ArtifactSigning @parameters
`

export function windowsArtifactSigningOptions(signing, run = execFileSync) {
  return {
    publisherName: signing.publisherName,
    signingHashAlgorithms: ['sha256'],
    sign: async ({ path }) => {
      run(
        'pwsh.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', artifactSigningCommand],
        {
          stdio: 'inherit',
          windowsHide: true,
          timeout: 360000,
          env: {
            ...process.env,
            // Keep paths and resource names as data, never PowerShell source.
            DOVO_ARTIFACT_SIGNING_REQUEST: JSON.stringify({
              Endpoint: signing.endpoint,
              CodeSigningAccountName: signing.codeSigningAccountName,
              CertificateProfileName: signing.certificateProfileName,
              Files: path,
              FileDigest: 'SHA256',
              TimestampRfc3161: 'http://timestamp.acs.microsoft.com',
              TimestampDigest: 'SHA256',
            }),
          },
        },
      )
    },
  }
}

export function windowsReleaseConfig(root, variant) {
  return {
    win: { icon: join(root, 'apps/desktop/build/icon.png') },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      artifactName: `${variant.artifactPrefix}-\${version}-windows-\${arch}.\${ext}`,
    },
  }
}

export function windowsSigningOptions(env = process.env) {
  const required = [
    'AZURE_SIGNING_ENDPOINT',
    'AZURE_SIGNING_ACCOUNT',
    'AZURE_SIGNING_PROFILE',
    'AZURE_SIGNING_PUBLISHER',
  ]
  for (const name of required) {
    if (!env[name]?.trim()) throw new Error(`Missing ${name}`)
  }
  const endpoint = new URL(env.AZURE_SIGNING_ENDPOINT)
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.codesigning.azure.net'))
    throw new Error('AZURE_SIGNING_ENDPOINT must be an Azure Artifact Signing HTTPS endpoint')
  return {
    endpoint: endpoint.href,
    codeSigningAccountName: env.AZURE_SIGNING_ACCOUNT,
    certificateProfileName: env.AZURE_SIGNING_PROFILE,
    publisherName: env.AZURE_SIGNING_PUBLISHER,
  }
}
