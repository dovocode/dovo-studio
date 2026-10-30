#!/bin/bash
# Runs the actual patched native clients against loopback sockets. The simulator ID
# is optional; without it the CocoaAsyncSocket test runs on macOS.
set -euo pipefail
if [ "${1:-}" = "--" ]; then shift; fi
root="$(cd "$(dirname "$0")/../../.." && pwd)"
fixtures="$root/apps/mobile/scripts/peer-half-close-fixtures"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/dovo-half-close.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
package="$(cd "$root" && node -p "require('path').dirname(require.resolve('react-native-tcp-socket/package.json', { paths: ['./apps/mobile'] }))")"
cp -R "$package" "$tmp/socket"
patch="$root/patches/react-native-tcp-socket@6.4.3.patch"
if git -C "$tmp/socket" apply --reverse --check "$patch" 2>/dev/null; then
  : # Installed copy already has this exact patch.
elif git -C "$tmp/socket" apply --check "$patch" 2>/dev/null; then
  git -C "$tmp/socket" apply "$patch"
else
  echo 'Installed TCP dependency does not match the patch' >&2
  exit 1
fi
cp -R "$fixtures/android" "$fixtures/com" "$tmp/"
cp "$tmp/socket/android/src/main/java/com/asterinet/react/tcpsocket/TcpSocket.java" "$tmp/com/asterinet/react/tcpsocket/"
cp "$tmp/socket/android/src/main/java/com/asterinet/react/tcpsocket/TcpSocketClient.java" "$tmp/com/asterinet/react/tcpsocket/"
find "$tmp/android" "$tmp/com" -name '*.java' -print > "$tmp/java-sources"
javac -d "$tmp/classes" @"$tmp/java-sources"
java -cp "$tmp/classes" com.asterinet.react.tcpsocket.Test early
java -cp "$tmp/classes" com.asterinet.react.tcpsocket.Test
if [ "${1:-}" = "--android-only" ]; then exit 0; fi
mkdir -p "$tmp/include/React" "$tmp/include/CocoaAsyncSocket"
printf '#import <Foundation/Foundation.h>\n' > "$tmp/include/React/RCTBridgeModule.h"
printf '#define RCTLogWarn(...) do {} while (0)\n' > "$tmp/include/React/RCTLog.h"
cocoa="$root/apps/mobile/ios/Pods/CocoaAsyncSocket/Source/GCD"
cp "$cocoa/GCDAsyncSocket.h" "$tmp/include/CocoaAsyncSocket/"
platform=macosx
if [ "${1:-}" ]; then platform=iphonesimulator; fi
sdk="$(xcrun --sdk "$platform" --show-sdk-path)"
target=arm64-apple-macos13
if [ "$platform" = iphonesimulator ]; then target=arm64-apple-ios16.4-simulator; fi
xcrun clang -target "$target" -isysroot "$sdk" -fobjc-arc -Wno-deprecated-declarations \
  -I "$tmp/include" -I "$tmp/socket/ios" "$fixtures/ios.m" \
  "$tmp/socket/ios/TcpSocketClient.m" "$cocoa/GCDAsyncSocket.m" \
  -framework Foundation -framework Security -framework CFNetwork -o "$tmp/test-ios"
if [ "$platform" = iphonesimulator ]; then
  xcrun simctl spawn "$1" "$tmp/test-ios" early
  xcrun simctl spawn "$1" "$tmp/test-ios"
else
  "$tmp/test-ios" early
  "$tmp/test-ios"
fi
