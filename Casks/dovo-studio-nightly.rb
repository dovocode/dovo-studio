cask "dovo-studio-nightly" do
  version "0.0.9-nightly.259"
  sha256 "3af36db3dbad4979f217fc13a8e3ad2616709155ef2218261198e9e42f0cb16c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.259/Dovo-Studio-Nightly-0.0.9-nightly.259-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
