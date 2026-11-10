class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.776"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.776/Dovo-Server-Nightly-0.0.9-nightly.776-macos-arm64.tar.gz"
      sha256 "b5eb17fe42b6e43697e35349c8a1669d680201316ed81fab27d205842eeb601c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.776/Dovo-Server-Nightly-0.0.9-nightly.776-linux-arm64.tar.gz"
      sha256 "583ed20375f869b82b7f3ecf8d4b09cd2196b509e486ccb62362171716f2a693"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.776/Dovo-Server-Nightly-0.0.9-nightly.776-linux-x64.tar.gz"
      sha256 "1ffa15f0990982ef7670223d0c1f6e0a13764f6b36121655cab83964e187654a"
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
