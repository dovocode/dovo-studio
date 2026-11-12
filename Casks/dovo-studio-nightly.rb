cask "dovo-studio-nightly" do
  version "0.0.9-nightly.822"
  sha256 "c5324ef8bb39353185bd4011092a4665c362e1af9c10131de366e45ac36d4948"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.822/Dovo-Studio-Nightly-0.0.9-nightly.822-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
