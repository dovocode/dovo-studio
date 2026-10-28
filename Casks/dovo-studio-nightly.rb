cask "dovo-studio-nightly" do
  version "0.0.9-nightly.563"
  sha256 "ee64c42ffcd6b9889ba6548f11e66889f578e0bef8bc9b366010c4c9b44711aa"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.563/Dovo-Studio-Nightly-0.0.9-nightly.563-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
