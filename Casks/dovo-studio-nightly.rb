cask "dovo-studio-nightly" do
  version "0.0.9-nightly.581"
  sha256 "9aacc7e525fc4c61ddf76406a2b5736e1f25de8f800206c8a39bbfd6f71a4db6"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.581/Dovo-Studio-Nightly-0.0.9-nightly.581-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
