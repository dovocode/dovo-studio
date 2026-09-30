cask "dovo-studio-nightly" do
  version "0.0.7-nightly.101"
  sha256 "fbbb96cae4e27e0009de07d0318a35d96814e7aec7bc50cf4e86ea081ca43658"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.101/Dovo-Studio-Nightly-0.0.7-nightly.101-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
