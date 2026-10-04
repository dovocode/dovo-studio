cask "dovo-studio-nightly" do
  version "0.0.7-nightly.200"
  sha256 "c3f97fe53b62f2d605ec372ba4631129d3e8c80af8e9521b5ac84589a219bd6c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.200/Dovo-Studio-Nightly-0.0.7-nightly.200-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
