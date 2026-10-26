cask "dovo-studio-nightly" do
  version "0.0.9-nightly.519"
  sha256 "4b8d3272b5838bf48f6f915f072e4f9c0bdb45da8ce19ea1b7edd29c8a0e422c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.519/Dovo-Studio-Nightly-0.0.9-nightly.519-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
