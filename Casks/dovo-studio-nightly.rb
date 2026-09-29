cask "dovo-studio-nightly" do
  version "0.0.7-nightly.69"
  sha256 "f125cab2d948dca2332d81ec3074f134a05ee162b05f9306cd7d468e7474eb43"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.69/Dovo-Studio-Nightly-0.0.7-nightly.69-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
