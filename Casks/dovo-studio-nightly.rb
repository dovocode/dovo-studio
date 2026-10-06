cask "dovo-studio-nightly" do
  version "0.0.9-nightly.232"
  sha256 "4c9cdfab8de6db61cb36b0b63fd9a69ae691d1b4b6091e76d825f1fd9e7203d0"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.232/Dovo-Studio-Nightly-0.0.9-nightly.232-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
