cask "dovo-studio-nightly" do
  version "0.0.9-nightly.825"
  sha256 "ee9bd75d3c7cfed01c66c67c472cc96f6bf4958e78d14ed84c43b3ba614b2181"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.825/Dovo-Studio-Nightly-0.0.9-nightly.825-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
