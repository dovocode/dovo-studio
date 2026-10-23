cask "dovo-studio-nightly" do
  version "0.0.9-nightly.479"
  sha256 "31ac0ba310c2bbe3ce1878821e36d8de79287ac9158e8b42c93fbf467c8716c3"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.479/Dovo-Studio-Nightly-0.0.9-nightly.479-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
