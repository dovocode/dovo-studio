cask "dovo-studio-nightly" do
  version "0.0.7-nightly.23"
  sha256 "a5ef23b52fd487c9ffb67c5cc0ebb4c1165d6389b60775d04eb623ada532f65f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.23/Dovo-Studio-Nightly-0.0.7-nightly.23-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
