cask "dovo-studio-nightly" do
  version "0.0.9-nightly.593"
  sha256 "9135c9b0454967d984e7d4ea23b046b67ca3447a2d6ec10f15408eb39458e86a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.593/Dovo-Studio-Nightly-0.0.9-nightly.593-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
