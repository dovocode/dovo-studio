cask "dovo-studio-nightly" do
  version "0.0.9-nightly.655"
  sha256 "a1e1f0d3abed887c672de07dbaad7d866e6783f4e14d520b43897bacd7becdeb"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.655/Dovo-Studio-Nightly-0.0.9-nightly.655-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
