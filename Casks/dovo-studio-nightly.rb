cask "dovo-studio-nightly" do
  version "0.0.9-nightly.991"
  sha256 "3a33fd5c4e370b3b3a155e21d230961569be37c1e85f33ce7ded1004dc8a04f1"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.991/Dovo-Studio-Nightly-0.0.9-nightly.991-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
