cask "dovo-studio-nightly" do
  version "0.0.7-nightly.66"
  sha256 "b4ed4de8123a457915a0d149e10aca1291eb4e07bf66c90563f0766b0d11befd"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.66/Dovo-Studio-Nightly-0.0.7-nightly.66-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
