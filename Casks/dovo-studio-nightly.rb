cask "dovo-studio-nightly" do
  version "0.0.9-nightly.896"
  sha256 "a8b23f67dd24f0e9300d6714549ba0a7f43ab36436350ddce74dc65cdc5c53e8"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.896/Dovo-Studio-Nightly-0.0.9-nightly.896-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
