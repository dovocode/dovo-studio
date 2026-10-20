cask "dovo-studio-nightly" do
  version "0.0.9-nightly.417"
  sha256 "74bb2ef8f4d1ead2fcc7c5d442b16af52ac033ef4a1e9bcdb034ef7369f220b2"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.417/Dovo-Studio-Nightly-0.0.9-nightly.417-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
