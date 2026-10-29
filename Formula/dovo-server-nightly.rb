class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.577"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.577/Dovo-Server-Nightly-0.0.9-nightly.577-macos-arm64.tar.gz"
      sha256 "14cba9bfc0ef8934eae9fbf87660a5e7f90e1b53173c920f1ac026fd29f9d6b6"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.577/Dovo-Server-Nightly-0.0.9-nightly.577-linux-arm64.tar.gz"
      sha256 "1d112d906532b1c797cc62038caa8496e4624edae74c0912f08f6610adde1d64"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.577/Dovo-Server-Nightly-0.0.9-nightly.577-linux-x64.tar.gz"
      sha256 "69e7ddb65779b94d4bdbc3f817f01e7af80a4d534f3ef9c89021336bc105512b"
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
