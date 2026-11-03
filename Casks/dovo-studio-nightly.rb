cask "dovo-studio-nightly" do
  version "0.0.9-nightly.672"
  sha256 "7c7557679ecdf93ef1cb3aff4ff541c99095e28f3fbc54002a6c3fa24ac48d38"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.672/Dovo-Studio-Nightly-0.0.9-nightly.672-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
