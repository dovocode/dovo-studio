cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1049"
  sha256 "65c0de55a85f359e41cfb1de569d6d2f44c46c80b47a0a66c32af896406bd3d1"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1049/Dovo-Studio-Nightly-0.0.9-nightly.1049-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
