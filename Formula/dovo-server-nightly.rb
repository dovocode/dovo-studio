class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.387"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.387/Dovo-Server-Nightly-0.0.9-nightly.387-macos-arm64.tar.gz"
      sha256 "694295214ca1c1f1cb783aad04bf855392344d601636c8a12313e6df83e0572f"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.387/Dovo-Server-Nightly-0.0.9-nightly.387-linux-arm64.tar.gz"
      sha256 "c5a39d4abe78f3a29d4847e9e9230826444f62cbe42ec0f9f041740beb34b082"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.387/Dovo-Server-Nightly-0.0.9-nightly.387-linux-x64.tar.gz"
      sha256 "6b58a10005b35adc49ac701ab194bb310c71b9428cc8ca0b15a16e03d87dd993"
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
