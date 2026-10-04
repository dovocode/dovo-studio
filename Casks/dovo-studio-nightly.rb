cask "dovo-studio-nightly" do
  version "0.0.7-nightly.207"
  sha256 "219fa0736457d8b9e4e94b9424ab52fb43b7f6ac87ff000f3f0c57accdfb6c54"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.207/Dovo-Studio-Nightly-0.0.7-nightly.207-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
