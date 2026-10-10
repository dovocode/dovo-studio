cask "dovo-studio-nightly" do
  version "0.0.9-nightly.266"
  sha256 "3bc2640b44cfc60ab073fd16ec9d4c179c6813222b3735fb220b806307c07b24"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.266/Dovo-Studio-Nightly-0.0.9-nightly.266-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
