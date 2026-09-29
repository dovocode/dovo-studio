cask "dovo-studio-nightly" do
  version "0.0.7-nightly.29"
  sha256 "5ae4444421e6652aa90900f15082b960667bedec786cca24c62c75c3622b70e2"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.29/Dovo-Studio-Nightly-0.0.7-nightly.29-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
