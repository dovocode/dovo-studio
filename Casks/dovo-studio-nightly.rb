cask "dovo-studio-nightly" do
  version "0.0.7-nightly.67"
  sha256 "0de32b89c3315983dc02ce9ea4ce0bfc7ac07b75bc95549fe3eeee67910bdbec"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.67/Dovo-Studio-Nightly-0.0.7-nightly.67-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
