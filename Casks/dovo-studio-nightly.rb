cask "dovo-studio-nightly" do
  version "0.0.9-nightly.455"
  sha256 "3a9df905b14d3d08f122c6eb0faaad679bce22038d6eb391ca891efe7a9c7d9a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.455/Dovo-Studio-Nightly-0.0.9-nightly.455-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
