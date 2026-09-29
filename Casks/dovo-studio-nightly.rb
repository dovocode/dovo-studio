cask "dovo-studio-nightly" do
  version "0.0.7-nightly.37"
  sha256 "b0c5afbccf5fe32579e46431c9032fddf3806bfff495db95d3c265bc8b0cf09c"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.37/Dovo-Studio-Nightly-0.0.7-nightly.37-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
