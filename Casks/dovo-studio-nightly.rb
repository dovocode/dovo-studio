cask "dovo-studio-nightly" do
  version "0.0.9-nightly.595"
  sha256 "2893ee603f9d5636967beb18c540278005d5b8b0b21912f8d820b4c6a976f86c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.595/Dovo-Studio-Nightly-0.0.9-nightly.595-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
