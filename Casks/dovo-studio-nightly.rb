cask "dovo-studio-nightly" do
  version "0.0.7-nightly.90"
  sha256 "7fdd7d5e6fca8924db288800a2f969215876f4a553281ce9ca48f2d0c8507570"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.90/Dovo-Studio-Nightly-0.0.7-nightly.90-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
