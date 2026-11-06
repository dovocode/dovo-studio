cask "dovo-studio-nightly" do
  version "0.0.9-nightly.724"
  sha256 "7ffbd613f2693d668abe16fc4ff2f77bff7b0be119c574f2f6efabf0f22f0a37"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.724/Dovo-Studio-Nightly-0.0.9-nightly.724-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
