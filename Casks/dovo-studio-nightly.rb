cask "dovo-studio-nightly" do
  version "0.0.9-nightly.415"
  sha256 "b52fa95aafc829046dbccdb20373adf061314b30222c4bab542d79246c8aac0a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.415/Dovo-Studio-Nightly-0.0.9-nightly.415-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
