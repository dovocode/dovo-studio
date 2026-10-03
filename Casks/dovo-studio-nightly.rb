cask "dovo-studio-nightly" do
  version "0.0.7-nightly.181"
  sha256 "893c60fb45d3358c344803b61c117c9b01d682ec7658f2b2322f4feb1d082f06"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.181/Dovo-Studio-Nightly-0.0.7-nightly.181-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
