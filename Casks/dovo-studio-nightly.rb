cask "dovo-studio-nightly" do
  version "0.0.9-nightly.690"
  sha256 "c73a9569d2cf466968f0ce4aa9b528cc313f7fbec9ff9e3f26393a6c5f9af4ed"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.690/Dovo-Studio-Nightly-0.0.9-nightly.690-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
