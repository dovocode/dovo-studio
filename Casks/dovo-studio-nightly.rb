cask "dovo-studio-nightly" do
  version "0.0.7-nightly.92"
  sha256 "be008f47d7db54b65212e874de87ff2b6a6554e19886de6be27ecd2cad230cfc"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.92/Dovo-Studio-Nightly-0.0.7-nightly.92-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
