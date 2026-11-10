cask "dovo-studio-nightly" do
  version "0.0.9-nightly.774"
  sha256 "e1cc15003703a8beff832f5cdb13ce1aa3eed4dbbb14ff2c975f9a84ea4675d8"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.774/Dovo-Studio-Nightly-0.0.9-nightly.774-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
