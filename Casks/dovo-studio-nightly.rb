cask "dovo-studio-nightly" do
  version "0.0.9-nightly.638"
  sha256 "f18871eb07f8eeca38fb965ec494b36e09f352c0930de09d3f5cd0b88d04167b"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.638/Dovo-Studio-Nightly-0.0.9-nightly.638-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
