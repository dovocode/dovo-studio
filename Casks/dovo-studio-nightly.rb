cask "dovo-studio-nightly" do
  version "0.0.9-nightly.916"
  sha256 "a28f6e1a3d268b3b14e7dbbf278647509d33db4187dfa513830589363a28a9d6"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.916/Dovo-Studio-Nightly-0.0.9-nightly.916-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
