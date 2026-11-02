cask "dovo-studio-nightly" do
  version "0.0.9-nightly.658"
  sha256 "85d77592fee351f4b71b6d42c063984645dd4afae673c218dd998fca49759bd4"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.658/Dovo-Studio-Nightly-0.0.9-nightly.658-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
