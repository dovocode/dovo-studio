cask "dovo-studio-nightly" do
  version "0.0.7-nightly.72"
  sha256 "572809c4fb58bf536a57d95d0631d4abbbc01cd7f6bf60a25076ce8e32c0e455"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.72/Dovo-Studio-Nightly-0.0.7-nightly.72-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
