class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.859"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.859/Dovo-Server-Nightly-0.0.9-nightly.859-macos-arm64.tar.gz"
      sha256 "54d21c67bb7a676482685e64f13a3df7b0c47946b40dcc2f29ecb32047cb7bb2"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.859/Dovo-Server-Nightly-0.0.9-nightly.859-linux-arm64.tar.gz"
      sha256 "e49879f9c7038705d650721a7b84e5b5f947c496e8c6b8144a1b0a7875886ae6"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.859/Dovo-Server-Nightly-0.0.9-nightly.859-linux-x64.tar.gz"
      sha256 "ccec185e7bb3b80db8ea99c4767eb85fce7134707ac9fb1c0ebb8145120fe12e"
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
