# Native gallery checks

Discover the authorized Mac and simulator with Device Hub first. Use its returned simulator UDID.
These checks do not install on a physical phone.

## UIKit checks

On that Mac, from the mobile app directory:

```sh
bash modules/dovo-image-gallery/tests/run-simulator-harness.sh "$task_gallery_simulator"
```

The script builds a separate `com.dovo.imagegallery.harness` simulator app. It passes 12 checks for
selection, page release, zoom limits, decoding and retry. In particular, repeated layout must not
hide a decode failure. A new file must clear that failure and decode successfully.

## Expo bridge

Use a separate QA copy of the mobile app with its own dependencies and iOS project. Keep the app
bundle ID `com.dovo.imagegallery.bridge`. Give every extension a distinct bundle ID below that
prefix. Do not share its app container with Dovo. Run the normal project asset preparation and
CocoaPods setup in that copy. Confirm CocoaPods discovers `DovoImageGallery`.

In this QA copy only, make `ReactNativeDelegate.bundleURL()` return the embedded bundle in Debug:

```swift
return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
```

From its mobile app directory, build and install the fixture:

```sh
pnpm exec expo export:embed --entry-file modules/dovo-image-gallery/tests/bridge-entry.tsx --platform ios --dev false --bundle-output /tmp/dovo-gallery-bridge.jsbundle
xcodebuild -workspace ios/DovoStudio.xcworkspace -scheme DovoStudio -configuration Debug -sdk iphonesimulator -destination "id=$task_gallery_simulator" -derivedDataPath /tmp/dovo-gallery-bridge-build CODE_SIGNING_ALLOWED=NO SKIP_BUNDLING=1
cp /tmp/dovo-gallery-bridge.jsbundle /tmp/dovo-gallery-bridge-build/Build/Products/Debug-iphonesimulator/DovoStudio.app/main.jsbundle
xcrun simctl install "$task_gallery_simulator" /tmp/dovo-gallery-bridge-build/Build/Products/Debug-iphonesimulator/DovoStudio.app
xcrun simctl launch "$task_gallery_simulator" com.dovo.imagegallery.bridge
```

The initial title is `2 / 3 Second image.png`. The page is blue. Swipe to the failed third image.
The status must change to `Selected three`. Select Retry. It must change to `Retried three`, and the
blue image must appear. Select Show invalid bytes, then Retry. The same recovery must work after a
native decode failure. Share opens the system share sheet. Save opens the Files export picker with
the PNG. These checks do not confirm delivery to another app or a completed file export.

The fixture imports the real Expo view. It does not fetch attachments from a Dovo runtime. For the
JavaScript loading and ownership checks, run this from the repository root:

```sh
pnpm exec playwright install chromium
node scripts/check-image-gallery-browser.mjs
```

That check uses the real gallery component with native controls and file storage replaced. It covers
adjacent loading, decode retry, a new cache URI on retry, unmount guards and cache setup recovery.
Physical iPhone rendering and full-app runtime attachment loading remain separate checks.
