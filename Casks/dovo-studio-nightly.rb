cask "dovo-studio-nightly" do
  version "0.0.7-nightly.103"
  sha256 "f8e5281dd28f3d76e74b9b1fb79f1059735b322c9632563bdcfed80ad4921a86"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.103/Dovo-Studio-Nightly-0.0.7-nightly.103-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
