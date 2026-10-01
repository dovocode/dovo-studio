cask "dovo-studio-nightly" do
  version "0.0.7-nightly.140"
  sha256 "cb9367cb6f1af240c2062bbbf7b6d220ef58722b115b4b1f2518cac6c0ece146"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.140/Dovo-Studio-Nightly-0.0.7-nightly.140-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
