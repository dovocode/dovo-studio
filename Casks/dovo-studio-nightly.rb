cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1119"
  sha256 "52899479ca46f742c74621d2041565ea695870bd399a0ed4180a30b0366870bf"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1119/Dovo-Studio-Nightly-0.0.9-nightly.1119-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
