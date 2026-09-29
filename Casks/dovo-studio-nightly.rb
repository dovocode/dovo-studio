cask "dovo-studio-nightly" do
  version "0.0.7-nightly.35"
  sha256 "a1c4b66bb7db5f89603a672d18d57eb14adb2a2bfd525bfeb14706999f5caa0d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.35/Dovo-Studio-Nightly-0.0.7-nightly.35-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
