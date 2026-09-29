cask "dovo-studio-nightly" do
  version "0.0.7-nightly.52"
  sha256 "434b9b250ce03a03220dc906799ced03868965d4397c388135938e69b10a93a4"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.52/Dovo-Studio-Nightly-0.0.7-nightly.52-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
