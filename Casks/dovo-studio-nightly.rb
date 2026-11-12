cask "dovo-studio-nightly" do
  version "0.0.9-nightly.829"
  sha256 "4f805e279cd540cac4a15acdc0705dac27a3bfc1f60f1daf75933d93955876a8"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.829/Dovo-Studio-Nightly-0.0.9-nightly.829-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
