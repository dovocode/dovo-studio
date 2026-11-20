class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1004"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1004/Dovo-Server-Nightly-0.0.9-nightly.1004-macos-arm64.tar.gz"
      sha256 "b44677f253f3220b0f5feade3c6ff27699a955b000fae9aed238e37585384d8c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1004/Dovo-Server-Nightly-0.0.9-nightly.1004-linux-arm64.tar.gz"
      sha256 "0f4e1baa1493248f473491bc65d70a6abb8cc3b00f2b9a85bec3d063c5c10a50"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1004/Dovo-Server-Nightly-0.0.9-nightly.1004-linux-x64.tar.gz"
      sha256 "23c4b3025c23956a4156dfa0aca4f3fd4aa3da3dab1356169d75b429effa33a9"
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
