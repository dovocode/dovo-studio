cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1098"
  sha256 "3947977cb1574e999b6af01c973713718ddbd6289700cff2199856b9492e9aec"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1098/Dovo-Studio-Nightly-0.0.9-nightly.1098-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
