cask "dovo-studio-nightly" do
  version "0.0.9-nightly.910"
  sha256 "a2aab5540ac8b01e508d974f7f5412bc0751958c20693c7db90b9bc6968b8d55"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.910/Dovo-Studio-Nightly-0.0.9-nightly.910-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
