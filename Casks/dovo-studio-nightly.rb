cask "dovo-studio-nightly" do
  version "0.0.9-nightly.228"
  sha256 "184c921a072a1f708b057c0f7d03e146d856f162c1b8d50af6339796c7b2c8c9"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.228/Dovo-Studio-Nightly-0.0.9-nightly.228-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
