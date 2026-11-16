cask "dovo-studio-nightly" do
  version "0.0.9-nightly.918"
  sha256 "d8ce21299a4ccf7979e563f6a543f0d69f6238054452abf319f3c44234655590"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.918/Dovo-Studio-Nightly-0.0.9-nightly.918-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
