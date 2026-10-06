cask "dovo-studio-nightly" do
  version "0.0.9-nightly.239"
  sha256 "c2b40c35fd5835866f581460aab1e2ed632f224e10c71d97e21629a7d2f668fe"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.239/Dovo-Studio-Nightly-0.0.9-nightly.239-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
