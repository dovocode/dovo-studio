cask "dovo-studio-nightly" do
  version "0.0.9-nightly.258"
  sha256 "288bfe83fb6f0a963650de7d95c98d01c3290af7b7fbfdd1684635994c13f98f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.258/Dovo-Studio-Nightly-0.0.9-nightly.258-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
