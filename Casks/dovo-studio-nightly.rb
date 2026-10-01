cask "dovo-studio-nightly" do
  version "0.0.7-nightly.117"
  sha256 "5d09a53aed9ca2516bbfc4c10530b3f0d14cac7351e64877e850d38fb7e47215"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.117/Dovo-Studio-Nightly-0.0.7-nightly.117-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
