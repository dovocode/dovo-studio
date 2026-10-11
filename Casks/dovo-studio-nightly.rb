cask "dovo-studio-nightly" do
  version "0.0.9-nightly.275"
  sha256 "5c6a74935449e86782dc0e76a1c42ba11d26396187c682ea6cbd1bf2d48ada6d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.275/Dovo-Studio-Nightly-0.0.9-nightly.275-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
