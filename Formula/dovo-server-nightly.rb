class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.690"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.690/Dovo-Server-Nightly-0.0.9-nightly.690-macos-arm64.tar.gz"
      sha256 "33a1ffd25df276bf64d5d190317b11607f37119970980a3560faeed0efe9eab7"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.690/Dovo-Server-Nightly-0.0.9-nightly.690-linux-arm64.tar.gz"
      sha256 "3b0b8554b13ada81f07c2588ef4e6f551a6eff63fda0ce3374fb6b6e77afdda6"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.690/Dovo-Server-Nightly-0.0.9-nightly.690-linux-x64.tar.gz"
      sha256 "904095eefa62cdd949d00c423e5b0bcdb625f52c820cd9fb625f8139270c6821"
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
