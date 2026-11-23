cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1062"
  sha256 "986166a63ed4253b2801ec4c77da224e2b5266dab856b6d239d04f3ef135f654"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1062/Dovo-Studio-Nightly-0.0.9-nightly.1062-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
