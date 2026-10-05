cask "dovo-studio-nightly" do
  version "0.0.9-nightly.229"
  sha256 "c5805be8d418cd8cd64fa8d14d04ac16c06d73221879b7f0074dbce5a31fb8fc"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.229/Dovo-Studio-Nightly-0.0.9-nightly.229-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
