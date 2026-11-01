class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.636"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.636/Dovo-Server-Nightly-0.0.9-nightly.636-macos-arm64.tar.gz"
      sha256 "b6318323ae4fc5acae0ec07a1ad5318cafeb5c4d45796ff03bf375b2dc408bf4"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.636/Dovo-Server-Nightly-0.0.9-nightly.636-linux-arm64.tar.gz"
      sha256 "62458984888698219fbaf7636757f5fb32ab835aa552665cd6aa32c5f3d710b7"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.636/Dovo-Server-Nightly-0.0.9-nightly.636-linux-x64.tar.gz"
      sha256 "c677ea1d02af78270631c3a5107b9244592039de70b446c0feb79f72e384f501"
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
