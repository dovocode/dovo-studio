cask "dovo-studio-nightly" do
  version "0.0.7-nightly.167"
  sha256 "b1b95bf86e27d1298bac60d7106c8b8ba4ddb55c109362c47ebe2227a9663a30"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.167/Dovo-Studio-Nightly-0.0.7-nightly.167-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
