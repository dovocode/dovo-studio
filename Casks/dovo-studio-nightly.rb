cask "dovo-studio-nightly" do
  version "0.0.7-nightly.79"
  sha256 "c78f51834ae63eac414a778b550d0004faa2f1d6c5eeada32fc09970daa96056"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.79/Dovo-Studio-Nightly-0.0.7-nightly.79-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
