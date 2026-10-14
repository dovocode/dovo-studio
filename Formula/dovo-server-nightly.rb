class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.311"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.311/Dovo-Server-Nightly-0.0.9-nightly.311-macos-arm64.tar.gz"
      sha256 "a443256ff5b478f408919ab246c73bb149dc1f960763d6d463294a135b8755d8"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.311/Dovo-Server-Nightly-0.0.9-nightly.311-linux-arm64.tar.gz"
      sha256 "e7aa65a96c1a6ed8e43d85642b02f0737572078cabdd467a027bc4880fdde349"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.311/Dovo-Server-Nightly-0.0.9-nightly.311-linux-x64.tar.gz"
      sha256 "710308c85bbb34f81df3bb81c1eaa1c6d5fc49134f517cdba67087130970bc05"
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
