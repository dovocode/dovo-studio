cask "dovo-studio-nightly" do
  version "0.0.9-nightly.474"
  sha256 "4b6cd899d92c65716ef85095b9afcf3f01c05b6aac46832281de4a3efeccfbe2"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.474/Dovo-Studio-Nightly-0.0.9-nightly.474-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
