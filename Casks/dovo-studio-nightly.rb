cask "dovo-studio-nightly" do
  version "0.0.9-nightly.782"
  sha256 "d189b0fc19e1107db7b685a21240aa79c241d027416deb13c75cecc88434348a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.782/Dovo-Studio-Nightly-0.0.9-nightly.782-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
