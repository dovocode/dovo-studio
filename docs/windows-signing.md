# Windows signing setup

Release signs Windows x64 and ARM64 apps with Azure Artifact Signing using GitHub OIDC. No client
secret or certificate export is needed. Use the Azure portal in the intended Dovo account; the local
Azure CLI account is unrelated.

## Azure portal

1. Follow Microsoft's
   [Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
   in your intended tenant and subscription. Register `Microsoft.CodeSigning`, create an Artifact
   Signing account, complete identity validation, and create a **Public Trust** certificate profile.
   Public Trust Test and Private Trust profiles are unsuitable for public releases. Identity
   validation requires your participation and must finish before releases can be signed.
2. Copy the account's regional signing endpoint, account name, certificate profile name, and the
   certificate subject's **Common Name (CN)**. The CN must match the configured publisher exactly;
   it may be your verified legal name rather than “Dovocode”. Keep this publisher stable across
   releases because electron-updater checks it.
3. In Microsoft Entra ID, create an app registration for `dovo-studio-windows-signing`. Copy its
   Application (client) ID and Directory (tenant) ID. Do not create a client secret.
4. Under **Certificates & secrets → Federated credentials**, add a GitHub Actions credential:
   organization `dovocode`, repository `dovo-studio`, entity **Environment**, environment name
   `windows-signing`. The subject must be `repo:dovocode/dovo-studio:environment:windows-signing`,
   issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`.
5. Assign the app's service principal the **Artifact Signing Certificate Profile Signer** role
   scoped to the certificate profile. It does not need Contributor or subscription-wide signing
   access. See
   [resources and roles](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-resources-roles).

## GitHub environment

Create **Settings → Environments → windows-signing** in `dovocode/dovo-studio`. Add these
environment variables (not secrets; they identify resources and contain no private credential):

| Variable                  | Value                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `AZURE_CLIENT_ID`         | App registration's Application (client) ID                                              |
| `AZURE_TENANT_ID`         | Directory (tenant) ID                                                                   |
| `AZURE_SUBSCRIPTION_ID`   | Subscription containing the signing account                                             |
| `AZURE_SIGNING_ENDPOINT`  | Regional endpoint copied from the account, such as `https://weu.codesigning.azure.net/` |
| `AZURE_SIGNING_ACCOUNT`   | Artifact Signing account name                                                           |
| `AZURE_SIGNING_PROFILE`   | Public Trust certificate profile name                                                   |
| `AZURE_SIGNING_PUBLISHER` | Exact certificate Common Name (CN)                                                      |

Restrict deployments to `main` and release tags matching `v*`. Add required reviewers if you want
manual signing approval; leaving them unset preserves automatic nightly releases. A manual release
from another branch needs that branch allowed by the environment. Only the signing job receives
`id-token: write`; pull-request checks have no signing access.

## Build and verification

Windows builds and server smoke tests run on their native x64/ARM64 runners. The unpacked desktop
apps transfer to Windows x64 because the
[Azure signing action](https://github.com/Azure/artifact-signing-action) does not support Windows
ARM runners. The action signs app/runtime EXE, DLL and native Node modules with Windows PE headers;
foreign macOS/Linux prebuilds remain intact and are excluded from signing. electron-builder then
creates and signs the NSIS installer and uninstaller using its v26 Azure integration
(`azureSignOptions`, still named Trusted Signing upstream). This runs after Azure OIDC login and
uses the Azure CLI credential on the GitHub runner, not your local Azure CLI. Before NSIS embeds the
signed uninstaller, a build-time check verifies its embedded Authenticode signature and publisher.
An unsigned, invalid or unexpected-publisher uninstaller fails the build. During an upgrade,
`old-uninstaller.exe` is a copy of the previous installation's uninstaller; copying preserves its
signature, but signing a new release cannot sign an older unsigned installation.

Update manifests and blockmaps are generated from the final signed installers. The embedded update
configuration includes the publisher CN. Both architectures keep their existing stable/nightly feed
names. Signing configuration is mandatory for Release; missing configuration fails the job.
Standalone server ZIP archives retain their existing packaging; this setup signs desktop artifacts.
Local `package:platform` builds remain unsigned.

Once configured, run Release for a matching version/tag. Check both `windows-sign` matrix jobs: each
verifies Authenticode trust and publisher on the app binaries and installer before upload. Test
installation and an update on both architectures before publishing a stable draft. Existing unsigned
installations do not yet have the embedded publisher check; after installing a signed build,
subsequent updates verify that publisher. Signing does not guarantee SmartScreen reputation.
