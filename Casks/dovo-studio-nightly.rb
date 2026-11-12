cask "dovo-studio-nightly" do
  version "0.0.9-nightly.835"
  sha256 "70e93b56cf3a7d750a81453ef925285d211d4a9d7c640ea8b8daf0d616e95c4f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.835/Dovo-Studio-Nightly-0.0.9-nightly.835-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
