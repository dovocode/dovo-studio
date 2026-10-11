cask "dovo-studio-nightly" do
  version "0.0.9-nightly.280"
  sha256 "6f6e53544f8c0f9d2705f6504e8b4bd0372c0eb9009dd77e9fd402781abc93f2"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.280/Dovo-Studio-Nightly-0.0.9-nightly.280-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
