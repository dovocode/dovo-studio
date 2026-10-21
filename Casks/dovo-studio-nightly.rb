cask "dovo-studio-nightly" do
  version "0.0.9-nightly.431"
  sha256 "eae2e8ad2b63d6a329222317f7e5ec489ac4fac7efb7e3c9ba1d30efd708fee3"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.431/Dovo-Studio-Nightly-0.0.9-nightly.431-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
