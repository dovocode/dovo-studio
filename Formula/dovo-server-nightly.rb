class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.63"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.63/Dovo-Server-Nightly-0.0.7-nightly.63-macos-arm64.tar.gz"
      sha256 "7c4819b7bdbc2acd49071b3f731ea427fd37791ec0ff2fa075b587084338dc86"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.63/Dovo-Server-Nightly-0.0.7-nightly.63-linux-arm64.tar.gz"
      sha256 "7abf8894867e108058b1339f754eff9921bbb7e8a4250016b38c0fe1ec348d94"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.63/Dovo-Server-Nightly-0.0.7-nightly.63-linux-x64.tar.gz"
      sha256 "91158bfbc2dc9205ff3f88cf6bd3eb3948f3b62a81d66e694dd35ce22befb1eb"
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
