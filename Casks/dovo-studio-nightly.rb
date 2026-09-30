cask "dovo-studio-nightly" do
  version "0.0.7-nightly.102"
  sha256 "a012fccde8c5ed4ef8cdf566f7f1c69a95e232fc109039c92e2587a21cd58aad"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.102/Dovo-Studio-Nightly-0.0.7-nightly.102-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
