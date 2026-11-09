cask "dovo-studio-nightly" do
  version "0.0.9-nightly.759"
  sha256 "b474416ff293b5d5165a343b8e262235cc599d155a7502194da7515d455b240d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.759/Dovo-Studio-Nightly-0.0.9-nightly.759-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
