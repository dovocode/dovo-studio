class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.255"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.255/Dovo-Server-Nightly-0.0.9-nightly.255-macos-arm64.tar.gz"
      sha256 "19dc20d53bd7c044523a6c0056ed7259db53fcc673e49c9e2e53e721438e4ce6"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.255/Dovo-Server-Nightly-0.0.9-nightly.255-linux-arm64.tar.gz"
      sha256 "982c9699418d2c4e025cfcc68ec0f72a563e07dfc968e528dcd827e20c38c912"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.255/Dovo-Server-Nightly-0.0.9-nightly.255-linux-x64.tar.gz"
      sha256 "6c6f8df6ba4ca6489c688f137058bad57003538b444a04d282fe1961fdf499d2"
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
