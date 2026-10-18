cask "dovo-studio-nightly" do
  version "0.0.9-nightly.381"
  sha256 "c3e2105bd505a589feea5478022f286f8889a93e8877b08757a249cae35c0e52"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.381/Dovo-Studio-Nightly-0.0.9-nightly.381-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
