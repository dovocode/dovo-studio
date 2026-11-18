cask "dovo-studio-nightly" do
  version "0.0.9-nightly.973"
  sha256 "b35c633ecb99ad78e2f67c8dab94bfd8fb7252ee727783435627551dd604958f"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.973/Dovo-Studio-Nightly-0.0.9-nightly.973-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
