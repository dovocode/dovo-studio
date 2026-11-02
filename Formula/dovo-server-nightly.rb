class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.655"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.655/Dovo-Server-Nightly-0.0.9-nightly.655-macos-arm64.tar.gz"
      sha256 "b33c1963392a766fe0975372bd5e40bf765e3eb80451e3c757a54375e0020ad8"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.655/Dovo-Server-Nightly-0.0.9-nightly.655-linux-arm64.tar.gz"
      sha256 "5e81703373af8b04fdbab5503d3a61505b5116f9a2378247eb9eef3e0a8b57ae"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.655/Dovo-Server-Nightly-0.0.9-nightly.655-linux-x64.tar.gz"
      sha256 "30243f5779411e3d69f7d6f8ec4370eb614b777fa9461d6a358890d84fdde3a5"
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
