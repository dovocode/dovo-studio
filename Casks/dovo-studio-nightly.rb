cask "dovo-studio-nightly" do
  version "0.0.7-nightly.170"
  sha256 "1c94941e28b19c29796748b7d6ecec8889661a7c513a94539ddbcf5072f76ae4"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.170/Dovo-Studio-Nightly-0.0.7-nightly.170-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
