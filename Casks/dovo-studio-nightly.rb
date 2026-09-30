cask "dovo-studio-nightly" do
  version "0.0.7-nightly.99"
  sha256 "8c74155376ba0e3b4d403f3c9c6942e8ff76d020423c1d67bd5415d465a4f5fe"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.99/Dovo-Studio-Nightly-0.0.7-nightly.99-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
