class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.313"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.313/Dovo-Server-Nightly-0.0.9-nightly.313-macos-arm64.tar.gz"
      sha256 "27a35d86fa49dea38f9e191014e37674be9eb8ccd94cff325360f492694f126d"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.313/Dovo-Server-Nightly-0.0.9-nightly.313-linux-arm64.tar.gz"
      sha256 "39d635c748c2e459a4c5d4dbcf7fee509f0d833b9addf7f520d4316b4314cc59"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.313/Dovo-Server-Nightly-0.0.9-nightly.313-linux-x64.tar.gz"
      sha256 "39fa9e12c17822fc68b1088931da255a444525681cabb4c5c9b53dd4001fc93d"
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
