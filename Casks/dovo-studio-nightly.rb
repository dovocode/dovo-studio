cask "dovo-studio-nightly" do
  version "0.0.9-nightly.355"
  sha256 "d8ae3b21904359d0658636dea35d461d45c245a3bc4c8f1fdce74131cca22ef0"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.355/Dovo-Studio-Nightly-0.0.9-nightly.355-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
