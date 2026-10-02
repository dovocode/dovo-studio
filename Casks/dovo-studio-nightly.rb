cask "dovo-studio-nightly" do
  version "0.0.7-nightly.164"
  sha256 "cbcf2a2363545af6bb8c2327a5a9ac77158688364714827cb1b9dd2d7409b516"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.164/Dovo-Studio-Nightly-0.0.7-nightly.164-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
