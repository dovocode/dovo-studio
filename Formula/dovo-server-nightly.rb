class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.116"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.116/Dovo-Server-Nightly-0.0.7-nightly.116-macos-arm64.tar.gz"
      sha256 "25ee3c9b5a6fb5e802cb0022920975ba673f37772061b2256831bcebecdfb714"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.116/Dovo-Server-Nightly-0.0.7-nightly.116-linux-arm64.tar.gz"
      sha256 "d928411917e1a818287ce30ab4fe5d37cf18946931c4db2df3c3ded8923f95fc"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.116/Dovo-Server-Nightly-0.0.7-nightly.116-linux-x64.tar.gz"
      sha256 "9048ae8881d9b0f5ce06724a582ebff61a630037326acb886f5ca3f3ac43ae8d"
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
