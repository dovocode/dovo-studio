cask "dovo-studio-nightly" do
  version "0.0.9-nightly.985"
  sha256 "eafe85907dbc99ab0366428d1443f743d7fe075cba24b0eda5739fdd9a3fe729"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.985/Dovo-Studio-Nightly-0.0.9-nightly.985-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
