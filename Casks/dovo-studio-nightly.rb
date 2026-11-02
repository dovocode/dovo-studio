cask "dovo-studio-nightly" do
  version "0.0.9-nightly.663"
  sha256 "cd9fb2c13057a2328b5fffdbd74c011a8f7f4703a882a8251ba10f38ee686b9d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.663/Dovo-Studio-Nightly-0.0.9-nightly.663-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
