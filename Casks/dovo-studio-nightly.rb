cask "dovo-studio-nightly" do
  version "0.0.9-nightly.320"
  sha256 "a64bb263acb86d32ee167a77018fecdff3522c987785f59807f4696fda80b150"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.320/Dovo-Studio-Nightly-0.0.9-nightly.320-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
