cask "dovo-studio-nightly" do
  version "0.0.7-nightly.177"
  sha256 "29f6dd1fb132a8dfc45bd6748445b1ae91f2dea89486d42fcec699a8eb0fcd40"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.177/Dovo-Studio-Nightly-0.0.7-nightly.177-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
