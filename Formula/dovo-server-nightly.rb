class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.524"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.524/Dovo-Server-Nightly-0.0.9-nightly.524-macos-arm64.tar.gz"
      sha256 "8f99c31f1d6efe27bddf91be7240960876fff7d5b41ca9609b9170f93f7dbea0"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.524/Dovo-Server-Nightly-0.0.9-nightly.524-linux-arm64.tar.gz"
      sha256 "ef84a207452e1a3b14c7aa69ef95b0bc18ed7a640145818edae812af2d3568f9"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.524/Dovo-Server-Nightly-0.0.9-nightly.524-linux-x64.tar.gz"
      sha256 "dcb3bc95cf73fbc35f88ec64ee5149439e403fa8a51f93547313b17844578f46"
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
