cask "dovo-studio-nightly" do
  version "0.0.7-nightly.89"
  sha256 "e8aa4330a47acd2f31c8e7ca2f1699e5b6090a9d8e64cd3585ec1ba9b8e0f857"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.89/Dovo-Studio-Nightly-0.0.7-nightly.89-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
