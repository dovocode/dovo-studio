class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.346"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.346/Dovo-Server-Nightly-0.0.9-nightly.346-macos-arm64.tar.gz"
      sha256 "b5e4ed2c2f1cc0106b28ff9fcfb912b2c54cb64a4cd97c29810bcef978b159ad"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.346/Dovo-Server-Nightly-0.0.9-nightly.346-linux-arm64.tar.gz"
      sha256 "41673f38b06470c24f30711cffec89fd9cae445a89e88fb94e4888ee7a93a001"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.346/Dovo-Server-Nightly-0.0.9-nightly.346-linux-x64.tar.gz"
      sha256 "f47eb910b3636898de1918100a7337356f94da8b418e2ade4ddff484d42e88e6"
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
