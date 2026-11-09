cask "dovo-studio-nightly" do
  version "0.0.9-nightly.750"
  sha256 "a058d374088d531a4322e3819acf5666f33271f722b5b9dbab2ec2074c4a4fcf"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.750/Dovo-Studio-Nightly-0.0.9-nightly.750-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
