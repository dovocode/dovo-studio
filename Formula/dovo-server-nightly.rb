class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.841"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.841/Dovo-Server-Nightly-0.0.9-nightly.841-macos-arm64.tar.gz"
      sha256 "c1030837f9175b0848516b217b4334fdc36be0a483271d8f9b9252b6e474a586"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.841/Dovo-Server-Nightly-0.0.9-nightly.841-linux-arm64.tar.gz"
      sha256 "8b93433556f0eb1e74855a188aa1c7110a627cc68bd688d545c7188a7d526fd0"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.841/Dovo-Server-Nightly-0.0.9-nightly.841-linux-x64.tar.gz"
      sha256 "00e5ea09c2b13b0ba72400f8674f2420c7869205d13404a1db0555e4bdfe6457"
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
