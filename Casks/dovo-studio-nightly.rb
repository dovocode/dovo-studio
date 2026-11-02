cask "dovo-studio-nightly" do
  version "0.0.9-nightly.653"
  sha256 "7ca1a5b5a2623fb1241cfa4054a76bca1f24bf2a572357520266ba4a68159a8d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.653/Dovo-Studio-Nightly-0.0.9-nightly.653-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
