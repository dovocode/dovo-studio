cask "dovo-studio-nightly" do
  version "0.0.9-nightly.297"
  sha256 "35bdd381c439ac416cfa5fac12ae2fbbeb23245fb9a29b44924a39be7412da8a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.297/Dovo-Studio-Nightly-0.0.9-nightly.297-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
