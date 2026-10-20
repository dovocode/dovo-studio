class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.414"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.414/Dovo-Server-Nightly-0.0.9-nightly.414-macos-arm64.tar.gz"
      sha256 "3ac909066dd0947665c659231fc0bbbf7b76c448ea80cc8fd2231052ec6fd8b5"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.414/Dovo-Server-Nightly-0.0.9-nightly.414-linux-arm64.tar.gz"
      sha256 "4ce1feb8f7794cad68eacbd40475a6e6ec354bbd5fee26b6e1d6799e369ef0fe"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.414/Dovo-Server-Nightly-0.0.9-nightly.414-linux-x64.tar.gz"
      sha256 "c49b5981b0639431fca12af65c47fc43273b44ad497ab749d5e6eeb25a9730d7"
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
