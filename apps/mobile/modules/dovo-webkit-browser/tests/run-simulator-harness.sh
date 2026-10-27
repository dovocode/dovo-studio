#!/bin/zsh
# Builds the core Swift sources into a standalone harness app, installs it on a booted
# simulator (bundle id com.dovo.webkitbrowser.harness, separate from Dovo) and runs the browser, persistence and process-recovery phases.
# Usage: [PHASES="1 2 7"] run-simulator-harness.sh <simulator-udid> [port]
# Phases 3-5 are first-load latency diagnostics for plain WKWebViews; all phases use browser-only fixtures.
set -euo pipefail
UDID=${1:?simulator udid}
PORT=${2:-8765}
HERE=${0:A:h}
WORK=$(mktemp -d /tmp/dwb-harness.XXXXXX)
APP=$WORK/DovoWebKitHarness.app
mkdir -p $APP
SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
ARCH=$(uname -m)
xcrun -sdk iphonesimulator swiftc -parse-as-library -swift-version 5 -Onone -g \
  -target $ARCH-apple-ios17.0-simulator -sdk $SDK -module-name DovoWebKitHarness \
  $HERE/../ios/BrowserSupport.swift $HERE/../ios/BrowserTab.swift $HERE/../ios/BrowserEngine.swift \
  $HERE/harness/HarnessApp.swift \
  -o $APP/DovoWebKitHarness
cat > $APP/Info.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>DovoWebKitHarness</string>
  <key>CFBundleIdentifier</key><string>com.dovo.webkitbrowser.harness</string>
  <key>CFBundleName</key><string>DovoWebKitHarness</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>MinimumOSVersion</key><string>17.0</string>
  <key>LSRequiresIPhoneOS</key><true/>
  <key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
  <key>UILaunchScreen</key><dict/>
  <key>UIApplicationSceneManifest</key><dict><key>UIApplicationSupportsMultipleScenes</key><false/></dict>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict>
</dict></plist>
PLIST
codesign --force --sign - $APP
python3 -m http.server $PORT --bind :: --directory $HERE/fixture-site >$WORK/http.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true; echo "Harness logs: $WORK"' EXIT
sleep 1
xcrun simctl install $UDID $APP
STATUS=0
# Phase 4 warms the host HTTP server: the first simulator request to a freshly started
# python http.server on macOS stalls ~30 s regardless of data store (measured with phase 3).
for PHASE in ${=PHASES:-4 1 2 7}; do
  echo "== phase $PHASE"
  timeout 240 xcrun simctl launch --console --terminate-running-process $UDID com.dovo.webkitbrowser.harness -phase $PHASE -port $PORT >$WORK/phase$PHASE.log 2>&1 || true
  cat $WORK/phase$PHASE.log | grep -E "DWB-|rror|atal" || true
  if ! grep -q "DWB-DONE phase=$PHASE pass=[0-9]* fail=0" $WORK/phase$PHASE.log; then
    cat $WORK/phase$PHASE.log
    STATUS=1
  fi
done
echo "== http log"; tail -40 $WORK/http.log
exit $STATUS
