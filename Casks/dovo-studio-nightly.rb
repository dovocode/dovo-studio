cask "dovo-studio-nightly" do
  version "0.0.7-nightly.62"
  sha256 "f738cefc3a50c91e69c90fdc5ad50084df68d576b39d98612e53e60be6139ff6"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.62/Dovo-Studio-Nightly-0.0.7-nightly.62-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
