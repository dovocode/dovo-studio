cask "dovo-studio-nightly" do
  version "0.0.9-nightly.393"
  sha256 "446a5690a38e902a3e92ee839025963650f19785701d1fcaba1b186b3ab9b88f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.393/Dovo-Studio-Nightly-0.0.9-nightly.393-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
