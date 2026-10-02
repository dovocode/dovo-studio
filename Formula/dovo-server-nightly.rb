class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.163"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.163/Dovo-Server-Nightly-0.0.7-nightly.163-macos-arm64.tar.gz"
      sha256 "f54129a05eba02654031c2838d5603db4a81ebc376586b6b9b8b2207d0b37052"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.163/Dovo-Server-Nightly-0.0.7-nightly.163-linux-arm64.tar.gz"
      sha256 "206a498dd43dd71d9224a62461782b012dead949070931ac0d49e2309159b0c3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.163/Dovo-Server-Nightly-0.0.7-nightly.163-linux-x64.tar.gz"
      sha256 "8384a1481b8c284d3dab943173d90dd915aa35b8bbbeb94cd4622faea1cb5db8"
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
