cask "dovo-studio-nightly" do
  version "0.0.7-nightly.123"
  sha256 "24443e489062a797e401db43ea226c8cf6ffd8fb9f78b0d2b766c5fc887dfe65"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.123/Dovo-Studio-Nightly-0.0.7-nightly.123-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
