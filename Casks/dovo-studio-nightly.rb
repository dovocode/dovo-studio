cask "dovo-studio-nightly" do
  version "0.0.7-nightly.168"
  sha256 "29b3ae5509d659019280b71ae49fc7fdcd2a7f8f83ca38cc87478cd70eac89c2"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.168/Dovo-Studio-Nightly-0.0.7-nightly.168-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
