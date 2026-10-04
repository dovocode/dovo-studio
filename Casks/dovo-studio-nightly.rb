cask "dovo-studio-nightly" do
  version "0.0.7-nightly.209"
  sha256 "3ce18b0f8c40b975dd5cc175e712a2da7387aec8a2e00a5b74cec6b2f81cff92"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.209/Dovo-Studio-Nightly-0.0.7-nightly.209-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
