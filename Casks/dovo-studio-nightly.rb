cask "dovo-studio-nightly" do
  version "0.0.7-nightly.93"
  sha256 "d9e3055d6abc0cb0aab89d4b252fac691a4dba565cd100fbcd9a964700ffb650"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.93/Dovo-Studio-Nightly-0.0.7-nightly.93-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
