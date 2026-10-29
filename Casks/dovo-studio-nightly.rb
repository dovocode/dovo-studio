cask "dovo-studio-nightly" do
  version "0.0.9-nightly.588"
  sha256 "b59a6c61d016ba5b8589e53d85aa09c5d015fc941983674fc36e350a7068af07"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.588/Dovo-Studio-Nightly-0.0.9-nightly.588-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
