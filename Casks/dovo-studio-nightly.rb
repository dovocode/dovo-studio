cask "dovo-studio-nightly" do
  version "0.0.7-nightly.96"
  sha256 "d8ce320323204bedd8dc40c92b4299fcf5854b021b5c793ef975d379bef69623"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.96/Dovo-Studio-Nightly-0.0.7-nightly.96-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
