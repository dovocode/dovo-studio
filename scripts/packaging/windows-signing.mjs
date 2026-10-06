import { join } from 'node:path'

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
