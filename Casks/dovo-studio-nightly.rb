cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1008"
  sha256 "557fe92bbf49a0d57f46df2325a9fd713d2a0fa019e0169bf670ca3084138387"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1008/Dovo-Studio-Nightly-0.0.9-nightly.1008-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
