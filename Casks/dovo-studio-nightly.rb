cask "dovo-studio-nightly" do
  version "0.0.9-nightly.890"
  sha256 "e24731e7cc99d363bb1ae76e9bba0ffc973eb0deb4d477dd7d19d972d2c03b12"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.890/Dovo-Studio-Nightly-0.0.9-nightly.890-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
