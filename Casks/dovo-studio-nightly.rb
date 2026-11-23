cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1052"
  sha256 "afa3eebdfd900a33e3955ba48db2e1253d18aa1ec9a587fd7e175bbe5acf07a0"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1052/Dovo-Studio-Nightly-0.0.9-nightly.1052-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
