cask "dovo-studio-nightly" do
  version "0.0.9-nightly.456"
  sha256 "48d2759672a12499784d68fbe643d3f728994f07965113e1651e1b52cf7a441a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.456/Dovo-Studio-Nightly-0.0.9-nightly.456-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
