class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.701"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.701/Dovo-Server-Nightly-0.0.9-nightly.701-macos-arm64.tar.gz"
      sha256 "2c6a214640510c17e457bad10b8f0c6682437de85c6b6d2801d0f2454c59d259"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.701/Dovo-Server-Nightly-0.0.9-nightly.701-linux-arm64.tar.gz"
      sha256 "397fee4988019169080d9256c093677d37f950324c66414fbf3bb360e48d6a40"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.701/Dovo-Server-Nightly-0.0.9-nightly.701-linux-x64.tar.gz"
      sha256 "2252d82ab8aca8cec44093f1d417be8e3a4a15778e48ad315df8c2c7c8b6c2ed"
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
