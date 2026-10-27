cask "dovo-studio-nightly" do
  version "0.0.9-nightly.542"
  sha256 "9884a32c45dc5a0e87000f09f2d87aa7c01211e844662b5b2ed9c029c9f4779a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.542/Dovo-Studio-Nightly-0.0.9-nightly.542-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
