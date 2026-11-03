cask "dovo-studio-nightly" do
  version "0.0.9-nightly.670"
  sha256 "283274cf180e15d2f8d8824ac4003c7bf390a499096b69974b8a73de37ef3f46"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.670/Dovo-Studio-Nightly-0.0.9-nightly.670-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
