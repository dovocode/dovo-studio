class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.87"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.87/Dovo-Server-Nightly-0.0.7-nightly.87-macos-arm64.tar.gz"
      sha256 "ef19eb8b632d21cf1f44f0b42e1cfc38afe2febc0396905535df605bbc444642"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.87/Dovo-Server-Nightly-0.0.7-nightly.87-linux-arm64.tar.gz"
      sha256 "1bfe51ec42deb7565f355f3810bd25a219d6bb6ccd77547181870ca4674a44cd"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.87/Dovo-Server-Nightly-0.0.7-nightly.87-linux-x64.tar.gz"
      sha256 "12665a757265d2f6b5a3a127cffd538734bb4f5a8fc640d9351b2a052e74b4c0"
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
