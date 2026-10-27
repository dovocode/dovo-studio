cask "dovo-studio-nightly" do
  version "0.0.9-nightly.541"
  sha256 "15588c1763a9e60adfb8fbd3201d7c656da4f21cd47259726c10214c2dfca8aa"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.541/Dovo-Studio-Nightly-0.0.9-nightly.541-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
