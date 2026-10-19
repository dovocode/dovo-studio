class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.396"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.396/Dovo-Server-Nightly-0.0.9-nightly.396-macos-arm64.tar.gz"
      sha256 "a18eb8157d550e173d70af2acd17175dad0b0607dfb6c5620d509db9ebf6ebb3"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.396/Dovo-Server-Nightly-0.0.9-nightly.396-linux-arm64.tar.gz"
      sha256 "2451e0e99469cf254af01205a3c5dcc8fb08327bb5effbc26a857d9edc3d7879"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.396/Dovo-Server-Nightly-0.0.9-nightly.396-linux-x64.tar.gz"
      sha256 "011b9d2b9364e921c7a674bee783d3bc453d7877df15594472519ad8eac52a02"
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
