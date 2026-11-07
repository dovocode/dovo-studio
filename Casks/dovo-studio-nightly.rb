cask "dovo-studio-nightly" do
  version "0.0.9-nightly.728"
  sha256 "cabf7199863e7f1a7a7252a2c8c9333e8fd85e011523d8b99d4cf9795684196e"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.728/Dovo-Studio-Nightly-0.0.9-nightly.728-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
