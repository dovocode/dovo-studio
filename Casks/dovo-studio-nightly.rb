cask "dovo-studio-nightly" do
  version "0.0.7-nightly.187"
  sha256 "78c35de88d74a872e2507a193b78cdaa9237a07329677410719bb04ec73b8657"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.187/Dovo-Studio-Nightly-0.0.7-nightly.187-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
