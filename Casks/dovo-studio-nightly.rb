cask "dovo-studio-nightly" do
  version "0.0.9-nightly.767"
  sha256 "94eb9ae490c89732832f5989667a703f882ed655c8f48282b1f2101671b67164"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.767/Dovo-Studio-Nightly-0.0.9-nightly.767-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
