class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.402"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.402/Dovo-Server-Nightly-0.0.9-nightly.402-macos-arm64.tar.gz"
      sha256 "400c75be80bc7a5ae06e2f8d81b781cdcf21eccfcec72099cb18410393c79649"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.402/Dovo-Server-Nightly-0.0.9-nightly.402-linux-arm64.tar.gz"
      sha256 "8a60c9db1f5729d55645e7e8b15d8947065ea037af78f474a6991dba77791a32"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.402/Dovo-Server-Nightly-0.0.9-nightly.402-linux-x64.tar.gz"
      sha256 "ea87762085b86d962ca8d43abb3fad4aed8b3c9a07d160a26a158df77c07da12"
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
