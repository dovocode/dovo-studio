cask "dovo-studio-nightly" do
  version "0.0.9-nightly.524"
  sha256 "64822d5ec39a0c7d0904e353f4c75ec3546320136022393fe018945f8856f3ac"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.524/Dovo-Studio-Nightly-0.0.9-nightly.524-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
