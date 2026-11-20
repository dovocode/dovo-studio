class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1005"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1005/Dovo-Server-Nightly-0.0.9-nightly.1005-macos-arm64.tar.gz"
      sha256 "b9d139523bbeeffe107a558537e288f98bc302945fa87d8acece3e6d8f28b0a2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1005/Dovo-Server-Nightly-0.0.9-nightly.1005-linux-arm64.tar.gz"
      sha256 "9f9dbe61260c29f6a6432b93962eca8d8791ebc34767d3ea1e988e461577fcdf"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1005/Dovo-Server-Nightly-0.0.9-nightly.1005-linux-x64.tar.gz"
      sha256 "c14df6d89081d177b61c32c55d5f54d27aa5f8c24a07b14e88d7bf9822461942"
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
