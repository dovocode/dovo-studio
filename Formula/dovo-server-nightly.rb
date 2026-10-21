class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.427"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.427/Dovo-Server-Nightly-0.0.9-nightly.427-macos-arm64.tar.gz"
      sha256 "f9df4d5828510d3ed63e65f43c87790d8c71946f196c2ec1afb1c823a11ef48d"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.427/Dovo-Server-Nightly-0.0.9-nightly.427-linux-arm64.tar.gz"
      sha256 "ef6f47ed5c2002c51bf42819d7c21c09ee5cbea47699eef39ea36902c6b0252a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.427/Dovo-Server-Nightly-0.0.9-nightly.427-linux-x64.tar.gz"
      sha256 "e0aaca38469d907f3420a760fe9668ef5efe449db2e0de48c58b182e6232bafd"
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
