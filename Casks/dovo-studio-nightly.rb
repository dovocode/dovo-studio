cask "dovo-studio-nightly" do
  version "0.0.9-nightly.369"
  sha256 "9ada74dc64ccaa2605c89452c79ab7183219c6163be396a5623a19eeadf44b3c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.369/Dovo-Studio-Nightly-0.0.9-nightly.369-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
