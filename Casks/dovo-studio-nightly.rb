cask "dovo-studio-nightly" do
  version "0.0.9-nightly.668"
  sha256 "c6784922554669e540788b870b53ef16080545e397442d77bba71a5307eff908"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.668/Dovo-Studio-Nightly-0.0.9-nightly.668-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
