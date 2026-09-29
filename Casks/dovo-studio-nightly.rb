cask "dovo-studio-nightly" do
  version "0.0.7-nightly.65"
  sha256 "6034549455a659aaacfe97242591fcdc58f12e15f3c71e84c64b663173ba6a6d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.65/Dovo-Studio-Nightly-0.0.7-nightly.65-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
