cask "dovo-studio-nightly" do
  version "0.0.9-nightly.645"
  sha256 "ec5e1d6f9dc544ab8bdde17fb95533efc662da93b25d9b046466a89356ea4c43"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.645/Dovo-Studio-Nightly-0.0.9-nightly.645-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
