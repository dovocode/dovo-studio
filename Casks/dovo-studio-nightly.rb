cask "dovo-studio-nightly" do
  version "0.0.9-nightly.857"
  sha256 "6a87754e35c7dc84816d329189c0ecddab4fadd290f69afe77aa1c90f5468f03"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.857/Dovo-Studio-Nightly-0.0.9-nightly.857-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
