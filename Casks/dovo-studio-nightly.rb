cask "dovo-studio-nightly" do
  version "0.0.9-nightly.602"
  sha256 "d61cf3193c4097b3436cddb766abc17cff9bb8cd7de89b9377b2466c46db6439"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.602/Dovo-Studio-Nightly-0.0.9-nightly.602-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
