cask "dovo-studio-nightly" do
  version "0.0.7-nightly.76"
  sha256 "367db82bf6fad8c25e72454ab91b9f517d9165d1aad8634a64b6a945541b13ed"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.76/Dovo-Studio-Nightly-0.0.7-nightly.76-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
