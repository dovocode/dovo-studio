cask "dovo-studio-nightly" do
  version "0.0.7-nightly.171"
  sha256 "e8b7e62eea3b5e2eb397f78e1b567a0c7ede2d88851c36101711e06f3dd28057"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.171/Dovo-Studio-Nightly-0.0.7-nightly.171-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
