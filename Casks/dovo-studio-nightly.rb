cask "dovo-studio-nightly" do
  version "0.0.9-nightly.299"
  sha256 "e08c3f9b0f8d145fc965043ce9043b0f6193d936786f46b5544e920157803257"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.299/Dovo-Studio-Nightly-0.0.9-nightly.299-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
