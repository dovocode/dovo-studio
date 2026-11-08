#!/usr/bin/env bash
# Compiles the mobile app with the native Ghostty terminal (@dovo/terminal/native +
# expo-libghostty) for the iOS simulator on a remote Mac, in a fresh task-owned directory.
#
#   scripts/verify-mobile-ghostty-native-mac.sh [ssh-host]     (default: macbook-van-dominic)
#
# Safety: copies the working tree (without .git, node_modules, dist, build, ios, android) into a
# new `mktemp -d /tmp/dovo-ghostty-native-XXXXXX` directory and only ever writes there. No
# rsync --delete, no sudo, no signing (CODE_SIGNING_ALLOWED=NO), no device installs. Commands
# run in the user's login shell so Homebrew/Node/CocoaPods setup is preserved.
#
# Validates the checked-in config as is: the pnpm patch for expo-libghostty (fontFamily),
# expo-font terminal fonts, iOS 16.4 and the Metro singleton resolver.
set -euo pipefail
host=${1:-macbook-van-dominic}
root=$(cd "$(dirname "$0")/.." && pwd)
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30)

remote() { ssh "${ssh_opts[@]}" "$host" "zsh -lc $(printf '%q' "$1")"; }

dir=$(remote 'mktemp -d /tmp/dovo-ghostty-native-XXXXXX')
case "$dir" in /tmp/dovo-ghostty-native-*) ;; *) echo "unexpected remote dir: $dir" >&2; exit 1 ;; esac
echo "remote dir: $host:$dir"

tar -C "$root" -cf - \
  --exclude=./.git --exclude='node_modules' --exclude='dist' --exclude='build' \
  --exclude=./apps/mobile/ios --exclude=./apps/mobile/android --exclude='.expo' . |
  ssh "${ssh_opts[@]}" "$host" "tar -xf - -C $(printf '%q' "$dir")"

remote "$(cat <<EOF
set -euo pipefail
cd $(printf '%q' "$dir")
mkdir -p logs
{
  echo "macOS \$(sw_vers -productVersion)"; xcodebuild -version; node -v; pnpm -v; pod --version
} | tee logs/toolchain.txt

echo '== pnpm install --frozen-lockfile'
pnpm install --frozen-lockfile > logs/install.log 2>&1 || { tail -40 logs/install.log; exit 1; }

echo '== verify patched expo-libghostty and its prebuilt binaries'
pkg=\$(cd -P packages/terminal/node_modules/expo-libghostty && pwd)
grep -q 'Prop("fontFamily")' "\$pkg/ios/ExpoLibghosttyModule.swift" || { echo 'expo-libghostty patch not applied'; exit 1; }
test -d "\$pkg/ios/vendor/Frameworks/GhosttyKit.xcframework" || { echo 'GhosttyKit.xcframework missing: postinstall did not run'; exit 1; }

echo '== build JS workspace assets'
(cd apps/mobile && pnpm run preios) > logs/preios.log 2>&1 || { tail -40 logs/preios.log; exit 1; }

echo '== expo prebuild ios --no-install'
(cd apps/mobile && CI=1 pnpm exec expo prebuild --platform ios --no-install) > logs/prebuild.log 2>&1 || { tail -60 logs/prebuild.log; exit 1; }

echo '== pod install'
(cd apps/mobile/ios && pod install) > logs/pods.log 2>&1 || { tail -60 logs/pods.log; exit 1; }
grep -E 'ExpoLibghostty|GhosttyKit|GhosttyTerminal|MSDisplayLink' logs/pods.log || true

echo '== xcodebuild (simulator, unsigned)'
workspace=\$(ls -d apps/mobile/ios/*.xcworkspace | head -1)
scheme=\$(basename "\$workspace" .xcworkspace)
set +e
xcodebuild -workspace "\$workspace" -scheme "\$scheme" -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "\$PWD/DerivedData" \
  CODE_SIGNING_ALLOWED=NO build > logs/xcodebuild.log 2>&1
status=\$?
set -e
grep -E 'ExpoLibghostty(View|Module)\.swift|error:' logs/xcodebuild.log | head -40
tail -5 logs/xcodebuild.log
app=\$(ls -d DerivedData/Build/Products/Debug-iphonesimulator/*.app 2>/dev/null | head -1)
echo "xcodebuild status=\$status app=\${app:-none}"
exit \$status
EOF
)"
