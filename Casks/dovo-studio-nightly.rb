cask "dovo-studio-nightly" do
  version "0.0.9-nightly.776"
  sha256 "e1c57b80574b93fbda0003ea7ea8f9b6b7e542149a2a30cedceb4629227601a1"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.776/Dovo-Studio-Nightly-0.0.9-nightly.776-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
