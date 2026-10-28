cask "dovo-studio-nightly" do
  version "0.0.9-nightly.556"
  sha256 "5ebf73abeec9b6899db6493ba087975cfa9ad20a007660c281f160423d5a293e"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.556/Dovo-Studio-Nightly-0.0.9-nightly.556-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
