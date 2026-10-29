cask "dovo-studio-nightly" do
  version "0.0.9-nightly.577"
  sha256 "30f03862334bde71a96b1af4e005a4f53d51d12b35ae868025cdb5a8bd7e3681"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.577/Dovo-Studio-Nightly-0.0.9-nightly.577-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
