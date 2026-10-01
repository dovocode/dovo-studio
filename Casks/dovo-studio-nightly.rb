cask "dovo-studio-nightly" do
  version "0.0.7-nightly.119"
  sha256 "323fe7479f74290849744572a42ab0edb88c6fffec49213677093c0e6efa40bf"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.119/Dovo-Studio-Nightly-0.0.7-nightly.119-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
