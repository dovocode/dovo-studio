cask "dovo-studio-nightly" do
  version "0.0.7-nightly.41"
  sha256 "a9b8620b39c3592194f77a6cb82e7310f55ada9cb71eefe8d5ce972d6d08fa63"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.41/Dovo-Studio-Nightly-0.0.7-nightly.41-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
