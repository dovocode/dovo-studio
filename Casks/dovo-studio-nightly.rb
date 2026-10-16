cask "dovo-studio-nightly" do
  version "0.0.9-nightly.350"
  sha256 "008a120c27196b7140fbdb40e2d418b4bf9e4b5ffddc89dd0ed19de69fce17d3"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.350/Dovo-Studio-Nightly-0.0.9-nightly.350-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
