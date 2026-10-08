cask "dovo-studio-nightly" do
  version "0.0.9-nightly.255"
  sha256 "a04d46c959e684e3718c9a0edbd2dd038b7a01d07a235f7d4d777d0861b3ce51"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.255/Dovo-Studio-Nightly-0.0.9-nightly.255-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
