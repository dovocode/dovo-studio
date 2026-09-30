cask "dovo-studio-nightly" do
  version "0.0.7-nightly.95"
  sha256 "b65a0785e967a0fa263f5d3170d166eded38e4f37bef1b61ce617ad6307c455c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.95/Dovo-Studio-Nightly-0.0.7-nightly.95-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
