cask "dovo-studio-nightly" do
  version "0.0.7-nightly.149"
  sha256 "252569c3e6cfe8ad3486b090efe12f98dab7c8ad1713f14eba51d4f5593f52a0"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.149/Dovo-Studio-Nightly-0.0.7-nightly.149-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
