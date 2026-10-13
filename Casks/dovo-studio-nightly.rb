cask "dovo-studio-nightly" do
  version "0.0.9-nightly.307"
  sha256 "12a15f24ecfd86643079c0866c23db3300734b2ea9654bf1c639f41c8dbffaf0"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.307/Dovo-Studio-Nightly-0.0.9-nightly.307-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
