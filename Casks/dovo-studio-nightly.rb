cask "dovo-studio-nightly" do
  version "0.0.9-nightly.891"
  sha256 "b88e8582c20cca81ecd9ef39c881cdf8a73f58d97dcfc8a06d34054b941f6aff"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.891/Dovo-Studio-Nightly-0.0.9-nightly.891-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
