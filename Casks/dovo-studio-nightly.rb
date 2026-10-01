cask "dovo-studio-nightly" do
  version "0.0.7-nightly.135"
  sha256 "c562628d73ad0a4922a971ecea483d897b1fa1d59cc8f0fddf02f8b08956ca0c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.135/Dovo-Studio-Nightly-0.0.7-nightly.135-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
