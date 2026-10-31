cask "dovo-studio-nightly" do
  version "0.0.9-nightly.603"
  sha256 "269438be41ecca97be8e936532a612bc253c81df0a22182df8237f3aefd82d89"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.603/Dovo-Studio-Nightly-0.0.9-nightly.603-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
