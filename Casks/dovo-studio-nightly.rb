cask "dovo-studio-nightly" do
  version "0.0.7-nightly.160"
  sha256 "f48d7982eaa0fdb5fbf85affcf6400e8d17537013aad15ce3f5b3f5b26854d50"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.160/Dovo-Studio-Nightly-0.0.7-nightly.160-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
