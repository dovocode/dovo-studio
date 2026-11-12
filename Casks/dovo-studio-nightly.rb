cask "dovo-studio-nightly" do
  version "0.0.9-nightly.842"
  sha256 "196611a821bcf2376a18dd43402c7e943a6d741f91331723b4ff22c7d185affd"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.842/Dovo-Studio-Nightly-0.0.9-nightly.842-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
