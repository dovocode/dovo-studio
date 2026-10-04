cask "dovo-studio-nightly" do
  version "0.0.7-nightly.208"
  sha256 "d59207cb99bac4ae39d3c066144d7958309541e62855e261bbcc7c2625b9aa3c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.208/Dovo-Studio-Nightly-0.0.7-nightly.208-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
