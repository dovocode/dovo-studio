cask "dovo-studio-nightly" do
  version "0.0.9-nightly.883"
  sha256 "26a79f35e5f66c0b90f07d63fa495e8138ad1d853b6e4358adc4b8ae21d0fb0d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.883/Dovo-Studio-Nightly-0.0.9-nightly.883-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
