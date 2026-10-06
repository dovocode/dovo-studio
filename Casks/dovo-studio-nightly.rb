cask "dovo-studio-nightly" do
  version "0.0.9-nightly.235"
  sha256 "a21ac68bd99f808f53111a9e6fce6a96f0b58888f7e1b3e0071b361565dd03e4"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.235/Dovo-Studio-Nightly-0.0.9-nightly.235-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
