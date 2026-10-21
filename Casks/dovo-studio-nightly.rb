cask "dovo-studio-nightly" do
  version "0.0.9-nightly.428"
  sha256 "42cc9d2a123c293369ffb0d104739328813bfac1af63a7933a5c329986ec34b0"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.428/Dovo-Studio-Nightly-0.0.9-nightly.428-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
