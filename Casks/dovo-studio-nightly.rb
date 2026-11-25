cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1106"
  sha256 "f930ab08a5bd48c52dae163cdc559873591b65b8d44e80498a1c0fde5c227e2e"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1106/Dovo-Studio-Nightly-0.0.9-nightly.1106-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
