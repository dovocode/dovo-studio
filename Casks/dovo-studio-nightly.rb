cask "dovo-studio-nightly" do
  version "0.0.9-nightly.545"
  sha256 "0ba38baf58dffc1f40fe5ddf98b1f90cf6da56e89f3986e4635ecb928ce05179"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.545/Dovo-Studio-Nightly-0.0.9-nightly.545-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
