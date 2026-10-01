cask "dovo-studio-nightly" do
  version "0.0.7-nightly.130"
  sha256 "51d3dc289bad03acf4cbd307b1c91d6d2a42cb48be847fdc9487ac6d385c4d28"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.130/Dovo-Studio-Nightly-0.0.7-nightly.130-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
