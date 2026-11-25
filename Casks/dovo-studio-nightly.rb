cask "dovo-studio-nightly" do
  version "0.0.9-nightly.1092"
  sha256 "6cabdcbaeeee3f0ff7a00f2e03b95c27f499fcf041fe64ac71edea66115bf7ff"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1092/Dovo-Studio-Nightly-0.0.9-nightly.1092-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
