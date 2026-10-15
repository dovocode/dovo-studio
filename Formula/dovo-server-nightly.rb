class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.337"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.337/Dovo-Server-Nightly-0.0.9-nightly.337-macos-arm64.tar.gz"
      sha256 "1128e6b8405b9c65e09bd5329a0c5a7d8f7f280c9ae006b95028608d457e6354"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.337/Dovo-Server-Nightly-0.0.9-nightly.337-linux-arm64.tar.gz"
      sha256 "54b359d086271ee8d389080cb35d710ae3659ddc4d533eca36c73bcf4cabc04e"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.337/Dovo-Server-Nightly-0.0.9-nightly.337-linux-x64.tar.gz"
      sha256 "d40ed3f51e4318354fa7dd20f7b861b49bb63a7427e3d90c28dda7adaaace618"
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
