cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1071"
  sha256 "74f1630addbd27d10026c06bbc18a488ea8c46b88c1d8db172fcaaaf5fc674a2"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1071/Dovo-Studio-Nightly-0.0.9-nightly.1071-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
