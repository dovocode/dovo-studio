cask "dovo-studio-nightly" do
  version "0.0.9-nightly.293"
  sha256 "5da165838a2ea42249798ae1303ad47b654e59c4659413bc5006332d79969ac5"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.293/Dovo-Studio-Nightly-0.0.9-nightly.293-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
