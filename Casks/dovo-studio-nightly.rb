cask "dovo-studio-nightly" do
  version "0.0.7-nightly.24"
  sha256 "69060f2198052bc989ccac0148e416c0dab66dcd2afb7b7fee6b5aa26ec4fdbb"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.24/Dovo-Studio-Nightly-0.0.7-nightly.24-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
