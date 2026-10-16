cask "dovo-studio-nightly" do
  version "0.0.9-nightly.344"
  sha256 "06d667ca5c77a4c6f120f8eb0b723e03f593064058bc964b0d5fa05124304e9b"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.344/Dovo-Studio-Nightly-0.0.9-nightly.344-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
