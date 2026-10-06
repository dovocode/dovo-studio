cask "dovo-studio-nightly" do
  version "0.0.9-nightly.237"
  sha256 "08931cc3820829dc41df78716065cecdf11dcd7414d9a5e3dce52c1130cfaa24"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.237/Dovo-Studio-Nightly-0.0.9-nightly.237-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
