cask "dovo-studio-nightly" do
  version "0.0.9-nightly.346"
  sha256 "31ede53d103003aebe020d7ab03dc2c1a18e2ce4a6b1de134f8efec25f9d321f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.346/Dovo-Studio-Nightly-0.0.9-nightly.346-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
