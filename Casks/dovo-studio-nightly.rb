cask "dovo-studio-nightly" do
  version "0.0.7-nightly.91"
  sha256 "b09a1fb70bf00ff8ffb56c44dc851f297c2e8246f75de9cbed432fd8a74e865a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.91/Dovo-Studio-Nightly-0.0.7-nightly.91-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
