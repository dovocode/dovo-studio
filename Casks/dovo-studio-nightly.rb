cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1123"
  sha256 "c999e6113968e49a776049fbb32e0e9283b2d138cc653d78dd07b43cefe263b0"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1123/Dovo-Studio-Nightly-0.0.9-nightly.1123-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
