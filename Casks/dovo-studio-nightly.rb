cask "dovo-studio-nightly" do
  version "0.0.7-nightly.146"
  sha256 "80abc658875588a93f2a39bd5ffedebd46b4b76f84de655b180d25983cf56662"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.146/Dovo-Studio-Nightly-0.0.7-nightly.146-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
