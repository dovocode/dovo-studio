cask "dovo-studio-nightly" do
  version "0.0.9-nightly.871"
  sha256 "50849d5ad8d72862a2461de7aeac916ea27ba32344f0ceb28800c7f6ce483512"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.871/Dovo-Studio-Nightly-0.0.9-nightly.871-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
