cask "dovo-studio-nightly" do
  version "0.0.7-nightly.138"
  sha256 "00084a3527d1683364d187824901758345e77eea010c5de9d9eb091b5b97b8c3"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.138/Dovo-Studio-Nightly-0.0.7-nightly.138-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
