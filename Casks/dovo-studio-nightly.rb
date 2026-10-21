cask "dovo-studio-nightly" do
  version "0.0.9-nightly.442"
  sha256 "e84ab94f44c57855bcd62181d0923e9c13089e2fe63f48fa34f295e6b2cee823"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.442/Dovo-Studio-Nightly-0.0.9-nightly.442-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
