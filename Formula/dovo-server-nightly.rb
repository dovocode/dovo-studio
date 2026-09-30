class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.106"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.106/Dovo-Server-Nightly-0.0.7-nightly.106-macos-arm64.tar.gz"
      sha256 "d25aa59086bfd6a0d1f4b297303bcfac63bb8594be4539df22ac6ff4672e6309"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.106/Dovo-Server-Nightly-0.0.7-nightly.106-linux-arm64.tar.gz"
      sha256 "495458bdb54410c7fb4123c22b94b68760a8125abbfee85580053c5b4b3458f5"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.106/Dovo-Server-Nightly-0.0.7-nightly.106-linux-x64.tar.gz"
      sha256 "2afc1f8a6cf909ccb9c2475cc8aaaa9e9c3cc3bef7747494133564cd93e5ec3c"
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
