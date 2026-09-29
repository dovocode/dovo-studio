cask "dovo-studio-nightly" do
  version "0.0.7-nightly.43"
  sha256 "6711ed482d77c4b61b81eef58f43b9ae320b4de1cbd52cc0e17d47eff0287962"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.43/Dovo-Studio-Nightly-0.0.7-nightly.43-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
