class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.204"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.204/Dovo-Server-Nightly-0.0.7-nightly.204-macos-arm64.tar.gz"
      sha256 "5b654c809e7372d27667142606d59fbf4d58cfeecfce689faa7b93587be06838"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.204/Dovo-Server-Nightly-0.0.7-nightly.204-linux-arm64.tar.gz"
      sha256 "262c42122c04cad4d5799480c03d6f68351364412ab233f99db259890c1801b3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.204/Dovo-Server-Nightly-0.0.7-nightly.204-linux-x64.tar.gz"
      sha256 "cb4336c6c270471d0787a8173fdcecaa5c97e2d909a4681152fd6e84ba53cf50"
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
