cask "dovo-studio-nightly" do
  version "0.0.7-nightly.109"
  sha256 "ecb489d4e11fc2820cfb063b3ca789f226f8ac6ea583fb948e5c98bf969ab637"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.109/Dovo-Studio-Nightly-0.0.7-nightly.109-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
