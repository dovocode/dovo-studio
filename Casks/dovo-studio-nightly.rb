cask "dovo-studio-nightly" do
  version "0.0.9-nightly.795"
  sha256 "5044459a769d38279cbf7dc2013a48733d15a32b827cf8996fe6f55ef870c020"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.795/Dovo-Studio-Nightly-0.0.9-nightly.795-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
