class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.950"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.950/Dovo-Server-Nightly-0.0.9-nightly.950-macos-arm64.tar.gz"
      sha256 "657d8f2fb58f06d8c528dbc3f474efb163b3ebb21c217452eb2e45f40aa88f1e"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.950/Dovo-Server-Nightly-0.0.9-nightly.950-linux-arm64.tar.gz"
      sha256 "0b280b86f4f1103fb44b1438aea6e3219955ef9050e790f9bb9bbffcc475079e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.950/Dovo-Server-Nightly-0.0.9-nightly.950-linux-x64.tar.gz"
      sha256 "3a25e8cfd00f55e908695ef6b486e6417b7b37091980874b78d23c98b9e6c1d2"
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
