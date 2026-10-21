cask "dovo-studio-nightly" do
  version "0.0.9-nightly.422"
  sha256 "6678a3a278ae8a8c99d903093433ca0a495b406593a551023ae437d078f14bd8"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.422/Dovo-Studio-Nightly-0.0.9-nightly.422-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
