cask "dovo-studio-nightly" do
  version "0.0.9-nightly.288"
  sha256 "8fb9fc50bc07669b3db4d48f0f0fcb8243e758b5174ed6848ed228c31a03068a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.288/Dovo-Studio-Nightly-0.0.9-nightly.288-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
