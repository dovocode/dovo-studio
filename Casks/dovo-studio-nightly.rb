cask "dovo-studio-nightly" do
  version "0.0.7-nightly.133"
  sha256 "4ee0bd2bfe10642f3b4d61bd766165d84b5c5f2c44cc16516304c7ac457151a3"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.133/Dovo-Studio-Nightly-0.0.7-nightly.133-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
