class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.141"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.141/Dovo-Server-Nightly-0.0.7-nightly.141-macos-arm64.tar.gz"
      sha256 "40c7c0cfcb5574b8b3fff7892441648b1b8b148eb692875e3858f01294e5917d"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.141/Dovo-Server-Nightly-0.0.7-nightly.141-linux-arm64.tar.gz"
      sha256 "e50a40fc108fabe050c8d857872d8bfad2ab56cde4d235d2e7fb6665e9fbafe4"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.141/Dovo-Server-Nightly-0.0.7-nightly.141-linux-x64.tar.gz"
      sha256 "178e0326e637c1a82b5046ad90685e6d43558b942f49534238688ab96672ea61"
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
