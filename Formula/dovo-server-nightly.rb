class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.31"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.31/Dovo-Server-Nightly-0.0.7-nightly.31-macos-arm64.tar.gz"
      sha256 "de5e63b56be12634b3ea66d06ed5db6d7fbbe059cbd365ffcb0640afd73c0f32"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.31/Dovo-Server-Nightly-0.0.7-nightly.31-linux-arm64.tar.gz"
      sha256 "68de8567f842ceea720c45bc501ee0b77a912e047ec8ba16420f102e9ee0716b"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.31/Dovo-Server-Nightly-0.0.7-nightly.31-linux-x64.tar.gz"
      sha256 "08e3dcbc6239ae9abf239275372ae7e82f3a1d405881bfd1e791012241065e9d"
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
