cask "dovo-studio-nightly" do
  version "0.0.9-nightly.243"
  sha256 "16f200f60bebfad74399ebb6be0547f4b2600c018ed568214a75ef21f6622b87"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.243/Dovo-Studio-Nightly-0.0.9-nightly.243-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
