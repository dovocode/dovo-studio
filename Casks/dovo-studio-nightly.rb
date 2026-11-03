cask "dovo-studio-nightly" do
  version "0.0.9-nightly.681"
  sha256 "f2a73d61cfb6e759e3e4944e01db73bd2cfc4f124f82e706d6757f755ec1b0e3"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.681/Dovo-Studio-Nightly-0.0.9-nightly.681-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
