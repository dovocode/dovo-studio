cask "dovo-studio-nightly" do
  version "0.0.7-nightly.155"
  sha256 "9bd4b66dec24e74ede2a560b7915ddd986663a1820384572eaf36afa4e8b69ac"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.155/Dovo-Studio-Nightly-0.0.7-nightly.155-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
