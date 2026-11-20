class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1009"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1009/Dovo-Server-Nightly-0.0.9-nightly.1009-macos-arm64.tar.gz"
      sha256 "cce594c438a06952464b324a61ac60236aa4495878301445ea91a37e5e86e28f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1009/Dovo-Server-Nightly-0.0.9-nightly.1009-linux-arm64.tar.gz"
      sha256 "704603d377472d1d813ba750ba47aa2762deeea68633a6d215a805be51a5cdf3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1009/Dovo-Server-Nightly-0.0.9-nightly.1009-linux-x64.tar.gz"
      sha256 "31bcbde90c2cb51568cbfe500549baf36ab3ae2c1d69a7b875dbb5681890cbc1"
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
