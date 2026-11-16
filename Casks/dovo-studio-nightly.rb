cask "dovo-studio-nightly" do
  version "0.0.9-nightly.924"
  sha256 "47e70bddb7b20e5583b88757d70e83fa4fa6dc7d06c54dc3d87d331ab766391a"
  url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.924/Dovo-Studio-Nightly-0.0.9-nightly.924-arm64.zip"
  name "Dovo Studio (Nightly)"
  desc "Native workspace for coding agents and connected devices"
  homepage "https://github.com/dovocode/dovo-studio"
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"
  auto_updates true
  app "Dovo Studio (Nightly).app"
end
