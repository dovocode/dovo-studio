cask "dovo-studio-nightly" do
  version "0.0.9-nightly.629"
  sha256 "7e8c44528424a1528fb539a590bd0df9d50c077156133a73f5f31ec75bc154e3"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.629/Dovo-Studio-Nightly-0.0.9-nightly.629-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
