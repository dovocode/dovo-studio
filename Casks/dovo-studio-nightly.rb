cask "dovo-studio-nightly" do
  version "0.0.9-nightly.789"
  sha256 "31e995db2547c00bd2b3033fa2ac9daaeb5b1110c82b20a69fcbd3fd2c4ec14d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.789/Dovo-Studio-Nightly-0.0.9-nightly.789-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
