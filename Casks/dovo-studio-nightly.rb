cask "dovo-studio-nightly" do
  version "0.0.9-nightly.245"
  sha256 "d3808a383c5cb6a98a46190ac13f98bece7bc9f3059cfd373fa501ce9cca352f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.245/Dovo-Studio-Nightly-0.0.9-nightly.245-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
