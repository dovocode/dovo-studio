cask "dovo-studio-nightly" do
  version "0.0.7-nightly.175"
  sha256 "246e37047c57fa7fabf9312b89ec0a9f9cc080594c1d4059b456421469f96860"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.175/Dovo-Studio-Nightly-0.0.7-nightly.175-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
