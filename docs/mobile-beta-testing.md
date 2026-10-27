# Mobile beta builds

The mobile app keeps `com.dovo.studio` on iOS and Android. Native store builds use the current
`apps/mobile/app.json` version and an explicit, increasing `DOVO_MOBILE_BUILD_NUMBER`. Choose a
number not previously uploaded to either store. No EAS account is required.

## TestFlight

On the Mac's logged-in login shell, with Xcode's existing developer account and signing keychain:

```sh
DOVO_APPLE_TEAM_ID=YOUR_TEAM_ID DOVO_MOBILE_BUILD_NUMBER=1 \
  pnpm mobile:package -- --platform ios
```

This regenerates the iOS project, archives for a generic physical iOS device, and exports an App
Store Connect IPA into `work/mobile-store/ios-VERSION-BUILD/`. The app, widgets and share extension
must all be provisioned for the same team. The app group is `group.com.dovo.studio`. Store builds
set production APNs in both the entitlement and the JavaScript token registration; development
installs continue to use sandbox. Do not use a development-signed device build for TestFlight.

Inspect the signed archive and upload with Xcode Organizer or Transporter using the existing
account. Wait for Apple's processing, resolve required export-compliance declarations, and select
the build in TestFlight. Internal testing and external testing have different tester and beta-review
requirements. Confirm actual testers, test information and review access before submitting an
external beta. Do not publish a production release as part of beta setup.

## Google Play closed testing

Use a private upload keystore and the Firebase Android app configuration for `com.dovo.studio`. Keep
the keystore and its passwords outside the checkout. In the build shell, configure:

- `DOVO_ANDROID_KEYSTORE`: absolute private keystore path.
- `DOVO_ANDROID_STORE_PASSWORD`, `DOVO_ANDROID_KEY_ALIAS`, `DOVO_ANDROID_KEY_PASSWORD`.
- `DOVO_GOOGLE_SERVICES_FILE`: private `google-services.json` for this app.

Then run:

```sh
DOVO_MOBILE_BUILD_NUMBER=1 pnpm mobile:package -- --platform android
```

The script builds a signed release AAB in `work/mobile-store/android-VERSION-BUILD/`. Generated
Gradle reads the upload credentials from the environment, not source files. It overrides Expo's
development signing for this build and never substitutes a debug key. Preserve an existing upload
key if this application already has one. Save and back up a newly created key privately before using
it for the first upload.

Upload the AAB to the existing app's closed-testing track and configure the actual tester
list/group. Google may require app setup declarations before release creation is available. Complete
content rating, audience, ads, app access, data safety, privacy URL, store listing and
account-verification requirements using reviewed facts. Store enrollment or legal/account
confirmations may require the account owner. Check Play's bundle analysis for supported devices and
native library requirements.

## Push delivery

The relay needs a Dovo APNs signing key for iOS and an authorized FCM service account for Android.
Android's `google-services.json` is app configuration, not a backend sending credential. An Apple
App Store Connect API key is not automatically an APNs key. Store sign-in alone does not create
provider credentials. See [notification setup](notification-relay.md).

Before inviting testers, install the distribution build on a real device, sign in optionally, pair a
server, enable task notifications, then verify a background input/completion notification and its
thread link. Verify that disabling one server leaves another enabled. Account-free pairing and HTTP
LAN/VPN connections remain supported.

## Manual mobile beta releases

The **Mobile beta release** GitHub Actions workflow is manual only. It builds iOS on `macos-26` and
Android on `ubuntu-24.04`, independently of desktop/server releases. Both **Check** and **Mobile
integration** must pass for the exact source commit before signing begins. Choose one or both
platforms; turn `upload` off to skip TestFlight/Play uploads while retaining signed artifacts and
publishing a separate GitHub mobile prerelease.

After those checks pass, start a build from Actions or run:

```sh
gh workflow run release-mobile.yml --ref main -f platform=all -f upload=true
```

Mobile GitHub releases use `mobile-vVERSION-beta.BUILD`, with the version from
`apps/mobile/app.json`. They never attach artifacts to desktop tags or become the repository's
latest stable release. Desktop publication never starts mobile builds, and Homebrew/mise
distribution ignores mobile tags.

Store versions retain `app.json`'s marketing version. Native build numbers use
`MOBILE_BUILD_NUMBER_BASE + workflow run number * 100 + run attempt`, with at most 99 attempts. The
default base `2026101902` exceeds the previous manual beta builds. Set the repository variable
`MOBILE_BUILD_NUMBER_BASE` above any future manual build before dispatching; never reset the
workflow run sequence or reuse a store build number. The Android limit is checked before a native
build.

The existing `mobile-nightly` GitHub environment is retained for its signing credentials and review
policy. Configure it for the intended manual release branches. Its secrets (or repository secrets
inherited by the environment) are:

| Secret                                                                                     | Value                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `APPLE_TEAM_ID`                                                                            | Existing Dovo team ID                                                                                                                                  |
| `MOBILE_IOS_CERTIFICATE`                                                                   | Base64 **selected Apple Distribution** `.p12`, with private key                                                                                        |
| `MOBILE_IOS_CERTIFICATE_PASSWORD`                                                          | That P12's private export password                                                                                                                     |
| `MOBILE_IOS_PROFILES`                                                                      | JSON mapping the app and both extension bundle IDs to base64 App Store `.mobileprovision` files (compressed to stay within GitHub’s secret size limit) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`                                                  | Existing Apple upload account and app-specific password                                                                                                |
| `MOBILE_ANDROID_KEYSTORE`                                                                  | Base64 preserved Android upload keystore                                                                                                               |
| `MOBILE_ANDROID_STORE_PASSWORD`, `MOBILE_ANDROID_KEY_ALIAS`, `MOBILE_ANDROID_KEY_PASSWORD` | Matching private upload signing values                                                                                                                 |
| `MOBILE_GOOGLE_SERVICES`                                                                   | Base64 Firebase `google-services.json` for `com.dovo.studio`                                                                                           |
| `MOBILE_PLAY_SERVICE_ACCOUNT`                                                              | Raw JSON for a **dedicated Play Publisher** account authorized for this app                                                                            |

Do not use Developer ID desktop certificates for iOS App Store builds. Do not export every identity
from a user's login keychain. Do not reuse the FCM relay credential as a Play Publisher credential.
CI installs private files and a separate temporary signing keychain; no secrets are included in
release artifacts, provenance JSON, or logs. Distribution profiles are checked for team, exact app
identifier, expiration, App Store eligibility and production APNs. Expired profiles must be renewed
and replaced privately. This pipeline does not depend on an interactive Xcode account session.

The iOS build applies manual profiles **after** Expo creates all extension targets, then exports an
App Store IPA and uploads through Apple's existing `altool`. TestFlight processing, external beta
review and public-link approval remain Apple gates. Configure the external group/public link in App
Store Connect; an upload alone does not make the build available to external testers.

Android uploads use Google's official API SDK and a validated edit. The environment/repository
variable `MOBILE_PLAY_TRACK` defaults to `beta` (open testing); `alpha` and `internal` are also
allowed, and **production is rejected**. Open testing must be enabled and available for this app
before promising anyone-with-link enrollment. With `MOBILE_BETA_DISTRIBUTION_READY` unset/false,
uploaded releases stay **draft**. Set it to `true` only after the testing track,
privacy/data-safety/content metadata, review access and required store review are ready; then
uploads request a completed beta release. Google may still require review or reject a release. No
automatic production submission is implemented. Read
[the disclosure evidence](mobile-store-disclosures.md) before completing forms.

The signed IPA/AAB and provenance (source SHA, mobile release tag, version, native build number and
SHA256) are retained as Actions artifacts for 14 days. Once every selected platform succeeds, a
separate GitHub mobile prerelease publishes both packages and their verified provenance. Incomplete
GitHub uploads leave a draft that can be resumed; published releases are not overwritten. A failed
store upload preserves the already-built Actions artifact and prevents final GitHub publication. App
Store IPAs are not a replacement for TestFlight enrollment. Build, GitHub publication, store upload,
review and distribution are distinct statuses.

## Installed-app release gate

The separate **Mobile integration** workflow builds a Release iOS simulator app, signs it ad hoc
with its normal entitlements, and installs it on a fresh disposable simulator. The Maestro release
smoke pairs with an isolated HTTP runtime, sends into an existing thread and a new thread, checks
draft retention through navigation, and opens App & updates. It runs on main pushes, pull requests
and manual dispatch. This integration gate is required for manual mobile releases; desktop nightlies
do not wait for it. Shared TypeScript, unit and browser checks remain in **Check**. The mobile
integration smoke does not verify Android, physical-device signing, push delivery, or
microphone/camera permissions.

On a Mac with Xcode, CocoaPods and Maestro 2.11.0, run:

```sh
node scripts/ci/mobile-native-smoke.mjs
```

The script owns and deletes only the simulator it creates. Its fixture pairing approval is limited
to the named test phone; it does not use a user's paired computers or phone. Failure screenshots and
Maestro diagnostics are retained in the Check run.
