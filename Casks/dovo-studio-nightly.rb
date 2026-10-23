cask "dovo-studio-nightly" do
  version "0.0.9-nightly.476"
  sha256 "23880d04f964ed4913e9744bfc811a0ce53bd32d74bca4b8b795ef345a47c6b4"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.476/Dovo-Studio-Nightly-0.0.9-nightly.476-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
