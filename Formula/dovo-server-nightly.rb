class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.80"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.80/Dovo-Server-Nightly-0.0.7-nightly.80-macos-arm64.tar.gz"
      sha256 "8595a156d784f5adf5e8a0d8fb17138359cc757c3d2650f731709d9a3bdd816f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.80/Dovo-Server-Nightly-0.0.7-nightly.80-linux-arm64.tar.gz"
      sha256 "55abebf3c086313d8f9502d1c453f7e0b6d80c2cff7e8f6a461f5d092372410d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.80/Dovo-Server-Nightly-0.0.7-nightly.80-linux-x64.tar.gz"
      sha256 "cfb21bd0444a38a30b7c576b2a16c0a6102dd1e123faca8b6cf0c8ec2b606ad8"
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
