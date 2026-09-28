cask "dovo-studio-nightly" do
  version "0.0.7-nightly.27"
  sha256 "2e8bf11f9d9a81a5810090d1e587df1620d23632ff0c3a300d58cf0388c72d41"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.27/Dovo-Studio-Nightly-0.0.7-nightly.27-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
