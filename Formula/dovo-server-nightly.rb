class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.541"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.541/Dovo-Server-Nightly-0.0.9-nightly.541-macos-arm64.tar.gz"
      sha256 "54c40e045bb52d387b19c40fb132dcf86b5fdfb22db9d8a804ed10343b541594"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.541/Dovo-Server-Nightly-0.0.9-nightly.541-linux-arm64.tar.gz"
      sha256 "626f532642bcdbe4037102bdc38100cc6321235ba8bfbadd3a452b9be29551cf"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.541/Dovo-Server-Nightly-0.0.9-nightly.541-linux-x64.tar.gz"
      sha256 "635067633928d2c464250ce725165b7cd36849449f49ac1b852831762ccd9d01"
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
