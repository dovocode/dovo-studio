cask "dovo-studio-nightly" do
  version "0.0.9-nightly.342"
  sha256 "c507ac5d3e1d34a7081ae97e5f56378d54121669b345aacb65aa68e39125e0eb"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.342/Dovo-Studio-Nightly-0.0.9-nightly.342-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
