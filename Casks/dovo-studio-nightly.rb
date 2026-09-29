cask "dovo-studio-nightly" do
  version "0.0.7-nightly.49"
  sha256 "1eb61047b7bacfd27d76bfc07186b4da1ca5cbbf44bed0dd57185634c4db49a0"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.49/Dovo-Studio-Nightly-0.0.7-nightly.49-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
