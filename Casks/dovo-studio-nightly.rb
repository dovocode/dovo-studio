cask "dovo-studio-nightly" do
  version "0.0.9-nightly.405"
  sha256 "ea040b1cfd6403d28dfdb3c1f5989acbcc334cd60fd2f1dcfb55150de8a536ec"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.405/Dovo-Studio-Nightly-0.0.9-nightly.405-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
