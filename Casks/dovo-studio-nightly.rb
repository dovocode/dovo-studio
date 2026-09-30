cask "dovo-studio-nightly" do
  version "0.0.7-nightly.86"
  sha256 "0342a52bca7d70371489d5efa623a1b22d3ef6f615ba67940177bc1398a7e17d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.86/Dovo-Studio-Nightly-0.0.7-nightly.86-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
