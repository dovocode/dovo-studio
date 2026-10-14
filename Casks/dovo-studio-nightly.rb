cask "dovo-studio-nightly" do
  version "0.0.9-nightly.319"
  sha256 "3db41554e8f3052091174a4241da01685af427f27736326e393231bd28576eb2"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.319/Dovo-Studio-Nightly-0.0.9-nightly.319-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
