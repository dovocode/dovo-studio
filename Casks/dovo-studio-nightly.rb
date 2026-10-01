cask "dovo-studio-nightly" do
  version "0.0.7-nightly.129"
  sha256 "e9ff6e0624b8542efb8fbb774e575d90374e913c948435ada7b2d45ef1638084"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.129/Dovo-Studio-Nightly-0.0.7-nightly.129-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
