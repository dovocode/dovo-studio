cask "dovo-studio-nightly" do
  version "0.0.7-nightly.178"
  sha256 "bee20c6564f65a8a3a741569a1fa17936587e12c751183b372fef418a03ec5de"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.178/Dovo-Studio-Nightly-0.0.7-nightly.178-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
