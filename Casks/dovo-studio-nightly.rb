cask "dovo-studio-nightly" do
  version "0.0.7-nightly.194"
  sha256 "36e08c79e774d89f6ba903c66c129914021e1d3e656843a872f701500fbf93e5"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.194/Dovo-Studio-Nightly-0.0.7-nightly.194-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
