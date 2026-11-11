class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.788"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.788/Dovo-Server-Nightly-0.0.9-nightly.788-macos-arm64.tar.gz"
      sha256 "4d3af01c92079eef2b5b7d9d30c775c3fad83579276cc5dc708cc0bba8dba9d3"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.788/Dovo-Server-Nightly-0.0.9-nightly.788-linux-arm64.tar.gz"
      sha256 "78fa2ba2f8485a544252ecb90eab780deac2e0157c8923c3a0c9680439e753f2"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.788/Dovo-Server-Nightly-0.0.9-nightly.788-linux-x64.tar.gz"
      sha256 "98f8496d8f2b699cefdbed8081c6bfa107fed8de425d5c2b4203d644836c4607"
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
