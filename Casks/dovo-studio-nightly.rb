cask "dovo-studio-nightly" do
  version "0.0.9-nightly.746"
  sha256 "ab658c4d2a104b1c6de588a1a2bdfe5a7e10714654059adeddb987d94946fe73"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.746/Dovo-Studio-Nightly-0.0.9-nightly.746-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
