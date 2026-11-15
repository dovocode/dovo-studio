#!/bin/bash
# Run on an authorized macOS host after Device Hub discovery.
set -euo pipefail
udid=${1:?Pass the discovered simulator UDID}
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d /tmp/dovo-gallery-harness.XXXXXX)
app="$work/DovoImageGalleryHarness.app"
mkdir -p "$app"
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
arch=$(uname -m)
xcrun --sdk iphonesimulator swiftc -parse-as-library -swift-version 5 -target "$arch-apple-ios16.0-simulator" -sdk "$sdk" -module-name DovoImageGalleryHarness "$here/../ios/ImageGalleryView.swift" "$here/harness.swift" -o "$app/DovoImageGalleryHarness"
cat > "$app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>DovoImageGalleryHarness</string>
<key>CFBundleIdentifier</key><string>com.dovo.imagegallery.harness</string>
<key>CFBundleName</key><string>DovoImageGalleryHarness</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>MinimumOSVersion</key><string>16.0</string>
<key>LSRequiresIPhoneOS</key><true/>
<key>UILaunchScreen</key><dict/>
<key>UIApplicationSceneManifest</key><dict><key>UIApplicationSupportsMultipleScenes</key><false/><key>UISceneConfigurations</key><dict><key>UIWindowSceneSessionRoleApplication</key><array><dict><key>UISceneConfigurationName</key><string>Default Configuration</string><key>UISceneDelegateClassName</key><string>DovoImageGalleryHarness.GalleryHarnessScene</string></dict></array></dict></dict>
</dict></plist>
PLIST
codesign --force --sign - "$app"
xcrun simctl install "$udid" "$app"
echo "Harness app: $app"
container=$(xcrun simctl get_app_container "$udid" com.dovo.imagegallery.harness data)
report="$container/Library/Caches/image-gallery/harness/report.txt"
rm -f "$report"
xcrun simctl launch --terminate-running-process "$udid" com.dovo.imagegallery.harness
for attempt in {1..30}; do
  if [ -f "$report" ]; then cat "$report"; exit 0; fi
  sleep 0.5
done
echo "No passing gallery report was written" >&2
exit 1
