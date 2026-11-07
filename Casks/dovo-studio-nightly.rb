cask "dovo-studio-nightly" do
  version "0.0.9-nightly.727"
  sha256 "1956ca72b372ad3d6aa563724698de8a91cb15b86afa5cdcce6c8ffe33e03e66"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.727/Dovo-Studio-Nightly-0.0.9-nightly.727-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
