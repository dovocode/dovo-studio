class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.435"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.435/Dovo-Server-Nightly-0.0.9-nightly.435-macos-arm64.tar.gz"
      sha256 "776de8224ad2ee51efc66914a18bcd4bc25f6e7c23393986dbb70405715ab154"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.435/Dovo-Server-Nightly-0.0.9-nightly.435-linux-arm64.tar.gz"
      sha256 "593ce5ea902153ac40c2258b64e5cb055c9ad49acbd02667cef5ca8f5497b324"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.435/Dovo-Server-Nightly-0.0.9-nightly.435-linux-x64.tar.gz"
      sha256 "739531753192e99fc7db32c0af703bf52446a16df8e8eaa63c469061a7495cda"
    end
  end
  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/dovo-server-nightly"
  end
  def caveats
    <<~EOS
      Configure: dovo-server-nightly setup
      Start:     dovo-server-nightly start
      Pair:      dovo-server-nightly pair
      Finish active work and stop before upgrading, then start again.
      Data is stored in ~/.dovo by default and is never removed by uninstall.
      This formula does not register an automatic login service.
    EOS
  end
  test do
    assert_match "Usage:", shell_output("#{bin}/dovo-server-nightly --help")
  end
end
