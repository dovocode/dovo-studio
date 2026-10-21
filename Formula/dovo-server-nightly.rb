class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.429"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.429/Dovo-Server-Nightly-0.0.9-nightly.429-macos-arm64.tar.gz"
      sha256 "83ad426fb75f5b1c633d9670ff99a0578602742dfd39a90e8583c85fcb4a746c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.429/Dovo-Server-Nightly-0.0.9-nightly.429-linux-arm64.tar.gz"
      sha256 "2938fb08ccc47f6bf199747f2cc96dba11465b44c76631486cdc49346b1341b9"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.429/Dovo-Server-Nightly-0.0.9-nightly.429-linux-x64.tar.gz"
      sha256 "93b28cea2ddb1f216766ebf6be6736da2a3f17c5d807ca94966747bdaff26288"
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
