cask "dovo-studio-nightly" do
  version "0.0.9-nightly.771"
  sha256 "9400435ca41f16f94dd9881bcbe90521919d012a020d88855108b7767464d2c3"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.771/Dovo-Studio-Nightly-0.0.9-nightly.771-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
