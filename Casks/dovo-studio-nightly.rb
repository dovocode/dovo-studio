cask "dovo-studio-nightly" do
  version "0.0.7-nightly.158"
  sha256 "838ec6a0e67310deb6ab7266df5f00299ae485531e2d6273e157aa180e55ddfb"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.158/Dovo-Studio-Nightly-0.0.7-nightly.158-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
