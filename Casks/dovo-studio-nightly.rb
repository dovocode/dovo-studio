cask "dovo-studio-nightly" do
  version "0.0.7-nightly.192"
  sha256 "0c434ed37742a2811516fc40a2d1da4839b184785b3544a07b80c7255961df5e"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.192/Dovo-Studio-Nightly-0.0.7-nightly.192-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
