class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.280"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.280/Dovo-Server-Nightly-0.0.9-nightly.280-macos-arm64.tar.gz"
      sha256 "397911d2f9f2d6e1e377240a913592b3b358f9feb509b8b86d586698d4d8634e"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.280/Dovo-Server-Nightly-0.0.9-nightly.280-linux-arm64.tar.gz"
      sha256 "c7bf6055a0d96a334c75b98c8f0b75979314d49e190ea925bb4780197fe5ffa5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.280/Dovo-Server-Nightly-0.0.9-nightly.280-linux-x64.tar.gz"
      sha256 "db067ee49bb036074c13086b8e890af854326aa89d11b20669f0804019bc0919"
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
