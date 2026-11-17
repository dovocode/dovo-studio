cask "dovo-studio-nightly" do
  version "0.0.9-nightly.950"
  sha256 "ca4cb014bb00dd7d15b1b444f30db71dc9d69f3a79915f81a7f0025581a6311a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.950/Dovo-Studio-Nightly-0.0.9-nightly.950-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
