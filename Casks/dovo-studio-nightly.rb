cask "dovo-studio-nightly" do
  version "0.0.7-nightly.113"
  sha256 "316784071f7dca30c1a6926c0bb7daa7bab25c5edf13721d3b7ace586d1de4d9"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.113/Dovo-Studio-Nightly-0.0.7-nightly.113-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
