cask "dovo-studio-nightly" do
  version "0.0.9-nightly.435"
  sha256 "8151f1993949ef16b2935dda0053e48cfac4648a200a1ba7c5dd6b6f854ca6dd"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.435/Dovo-Studio-Nightly-0.0.9-nightly.435-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
