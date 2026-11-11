cask "dovo-studio-nightly" do
  version "0.0.9-nightly.810"
  sha256 "76da0768293a10c97acd324ac5df3c7c3d7440ff6c6fe3cba831f545a2fa693c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.810/Dovo-Studio-Nightly-0.0.9-nightly.810-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
