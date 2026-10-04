cask "dovo-studio-nightly" do
  version "0.0.7-nightly.215"
  sha256 "f73af0098153651937594167c3a87233e7b448c1d2449dc5f27737771a95fe5a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.215/Dovo-Studio-Nightly-0.0.7-nightly.215-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
