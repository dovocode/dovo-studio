cask "dovo-studio-nightly" do
  version "0.0.9-nightly.384"
  sha256 "83d0455609c78baf1d215925bff39297c6ea8f2d4d3d8d103d09c14d59964072"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.384/Dovo-Studio-Nightly-0.0.9-nightly.384-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
