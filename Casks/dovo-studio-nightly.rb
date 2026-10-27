cask "dovo-studio-nightly" do
  version "0.0.9-nightly.538"
  sha256 "e1ea63e77d0cd4fed664e70d59018ab3fb22eb81109f4fd25ef9d573d8787734"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.538/Dovo-Studio-Nightly-0.0.9-nightly.538-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
