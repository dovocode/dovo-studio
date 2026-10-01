cask "dovo-studio-nightly" do
  version "0.0.7-nightly.125"
  sha256 "e6550e80b74f7f79114aacbe9ab326bd4f03897a61b91abb6bbf0d18aa84246c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.125/Dovo-Studio-Nightly-0.0.7-nightly.125-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
