cask "dovo-studio-nightly" do
  version "0.0.9-nightly.841"
  sha256 "15656321000584ca4f3b7c622444bd49d555671a9e970fefdb6c074b5017ae4d"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.841/Dovo-Studio-Nightly-0.0.9-nightly.841-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
