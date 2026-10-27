cask "dovo-studio-nightly" do
  version "0.0.9-nightly.551"
  sha256 "29c9afc3255bae48739495dcf3eeedb4478bfc1d0995daa812c43f3c9e02bdaf"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.551/Dovo-Studio-Nightly-0.0.9-nightly.551-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
