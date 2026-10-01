cask "dovo-studio-nightly" do
  version "0.0.7-nightly.116"
  sha256 "a110575c8a87b522d3cab9cda7350c7bdd7dba6cbe209929d142392f090a396e"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.116/Dovo-Studio-Nightly-0.0.7-nightly.116-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
