cask "dovo-studio-nightly" do
  version "0.0.7-nightly.183"
  sha256 "d505d294482b656751e8e10c9c829715ce8d90073e691e53f2405eefea69f316"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.183/Dovo-Studio-Nightly-0.0.7-nightly.183-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
