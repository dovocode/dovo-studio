cask "dovo-studio-nightly" do
  version "0.0.7-nightly.195"
  sha256 "50cee73f9744ab54139f45bc1de07b57013073c62badc478e732732f9ff5248d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.195/Dovo-Studio-Nightly-0.0.7-nightly.195-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
