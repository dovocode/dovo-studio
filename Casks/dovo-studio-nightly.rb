cask "dovo-studio-nightly" do
  version "0.0.9-nightly.410"
  sha256 "f7f8937b659aea33ef4b98489b2190e209034b4cb0d4073b11ef75e471344e86"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.410/Dovo-Studio-Nightly-0.0.9-nightly.410-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
