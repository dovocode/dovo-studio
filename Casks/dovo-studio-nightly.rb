cask "dovo-studio-nightly" do
  version "0.0.9-nightly.449"
  sha256 "136e5b4eb7ad1177026cb9612333a05b9658d7ad69915f1770557fd91c834f5c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.449/Dovo-Studio-Nightly-0.0.9-nightly.449-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
