cask "dovo-studio-nightly" do
  version "0.0.9-nightly.840"
  sha256 "fad026a835cddeabb29f6fc0f7442c7a763719b668e2698742bed5ccb0ca662f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.840/Dovo-Studio-Nightly-0.0.9-nightly.840-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
