class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.183"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.183/Dovo-Server-Nightly-0.0.7-nightly.183-macos-arm64.tar.gz"
      sha256 "5f070131df8b0ae0c6c8f3ee2706921a4b4ca887c791af7fb5f46170ca590eeb"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.183/Dovo-Server-Nightly-0.0.7-nightly.183-linux-arm64.tar.gz"
      sha256 "e1d5b2a2702d49db984d01d466a53d4d979fdbde33bae0c6978106c864e5c1c8"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.183/Dovo-Server-Nightly-0.0.7-nightly.183-linux-x64.tar.gz"
      sha256 "72d5669db556530f22e2a810d0d995cfea09f4bdc1ec2545ab7eb1b57af4a38a"
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
