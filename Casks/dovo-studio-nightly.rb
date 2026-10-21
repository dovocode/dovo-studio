cask "dovo-studio-nightly" do
  version "0.0.9-nightly.441"
  sha256 "7e5eff5826b72a17a6afef126aec3d20e198f85a94148cd0096cea37faa5ccfc"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.441/Dovo-Studio-Nightly-0.0.9-nightly.441-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
