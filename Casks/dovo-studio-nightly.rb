cask "dovo-studio-nightly" do
  version "0.0.9-nightly.747"
  sha256 "7cdd1a015c06caa0a6781b879fb0d3a9cc68b54d2887836839dd71701459459a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.747/Dovo-Studio-Nightly-0.0.9-nightly.747-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
