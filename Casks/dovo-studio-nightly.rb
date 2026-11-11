cask "dovo-studio-nightly" do
  version "0.0.9-nightly.788"
  sha256 "015f31342fb0944dea1cc3e51cdced7444fc8bd4885fa8cb14ba666cbc1d783e"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.788/Dovo-Studio-Nightly-0.0.9-nightly.788-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
