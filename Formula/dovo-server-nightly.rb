class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.613"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.613/Dovo-Server-Nightly-0.0.9-nightly.613-macos-arm64.tar.gz"
      sha256 "ea58b106683434392350e3b89c0f58bc7fd430927d17e4d8693f1e0900214f7e"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.613/Dovo-Server-Nightly-0.0.9-nightly.613-linux-arm64.tar.gz"
      sha256 "7ef89cc852e196d99c7adc22b46a5d84957e21f596ec0f7c91bb3bbb5e6d72f1"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.613/Dovo-Server-Nightly-0.0.9-nightly.613-linux-x64.tar.gz"
      sha256 "9b53ffa4bf14d1da434ab26b6261588f2d2ced4ad6a0832ac91c9be338f49694"
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
