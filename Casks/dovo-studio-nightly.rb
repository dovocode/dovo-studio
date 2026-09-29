cask "dovo-studio-nightly" do
  version "0.0.7-nightly.63"
  sha256 "fe0d74234c11bf603f20b3e769da9621af9290e30eb068b220fdfdefa50eba7b"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.63/Dovo-Studio-Nightly-0.0.7-nightly.63-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
