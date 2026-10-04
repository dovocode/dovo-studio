cask "dovo-studio-nightly" do
  version "0.0.7-nightly.201"
  sha256 "6714b2d1d201ad2aa707f1dd11978e225dada32d39ffb0c82e08dfb4a060a4c5"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.201/Dovo-Studio-Nightly-0.0.7-nightly.201-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
