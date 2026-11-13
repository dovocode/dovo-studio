cask "dovo-studio-nightly" do
  version "0.0.9-nightly.876"
  sha256 "9aa848033b1a30d0107acce11781bf8e257e5cad5b9f9722e4b51cd7bd87d1ea"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.876/Dovo-Studio-Nightly-0.0.9-nightly.876-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
