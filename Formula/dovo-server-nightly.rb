class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.90"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.90/Dovo-Server-Nightly-0.0.7-nightly.90-macos-arm64.tar.gz"
      sha256 "eb549e069ef1007172c5eac4169cc4e43349189c3f6e7424517536280a323027"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.90/Dovo-Server-Nightly-0.0.7-nightly.90-linux-arm64.tar.gz"
      sha256 "41d58fd53d0a9da756a692bf295e5b631b682bbe2adc5df73feb88faa74a79c0"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.90/Dovo-Server-Nightly-0.0.7-nightly.90-linux-x64.tar.gz"
      sha256 "ce5ee8569eed96ca11565ee4dc863ed90df892a5909d25a4eb036a3da277a420"
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
