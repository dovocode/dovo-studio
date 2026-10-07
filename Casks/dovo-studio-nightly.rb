cask "dovo-studio-nightly" do
  version "0.0.9-nightly.249"
  sha256 "55a4c5c31a6130ac6f2fc6bd9a6d1d1a878c70f40a0baff1487dbc4371ee25a3"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.249/Dovo-Studio-Nightly-0.0.9-nightly.249-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
