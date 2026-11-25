cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1104"
  sha256 "c5ad519ac5997280550322509707023f2788acc648117cda7b883380a941c357"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1104/Dovo-Studio-Nightly-0.0.9-nightly.1104-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
