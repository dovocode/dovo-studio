class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1106"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1106/Dovo-Server-Nightly-0.0.9-nightly.1106-macos-arm64.tar.gz"
      sha256 "9cbe61e0684999a14475f9e48c1ad8cf956f3e001f6c48d3d314f40dfaaac769"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1106/Dovo-Server-Nightly-0.0.9-nightly.1106-linux-arm64.tar.gz"
      sha256 "f4dffebcece3de6d4bd37ea5ebf7e532163b3876938b4f0998cf225a21102cf0"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1106/Dovo-Server-Nightly-0.0.9-nightly.1106-linux-x64.tar.gz"
      sha256 "5f51d324526b6bec0798e6c3c13193024ccbf9b761269cd64e975b33a0946644"
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
