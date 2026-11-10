cask "dovo-studio-nightly" do
  version "0.0.9-nightly.777"
  sha256 "bd83042e6a1d77664ba7a5daf9e559230f8fa231a92143e55317a7596bbff453"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.777/Dovo-Studio-Nightly-0.0.9-nightly.777-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
