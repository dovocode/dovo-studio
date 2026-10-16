cask "dovo-studio-nightly" do
  version "0.0.9-nightly.361"
  sha256 "d393de3adf8c4a856fee0378446e8f138583cf6a1cbed9100cbee4d101bf8bef"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.361/Dovo-Studio-Nightly-0.0.9-nightly.361-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
