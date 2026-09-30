cask "dovo-studio-nightly" do
  version "0.0.7-nightly.77"
  sha256 "863a9cbd330de2d4c70e98cec8cf341ff8becfe36f8a14427705ccb0728fe6b4"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.77/Dovo-Studio-Nightly-0.0.7-nightly.77-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
