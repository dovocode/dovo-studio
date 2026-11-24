class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1087"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1087/Dovo-Server-Nightly-0.0.9-nightly.1087-macos-arm64.tar.gz"
      sha256 "7c782c47ef6c8f8324440ea2657ed745cf0ce1fdb06a325408a6df2e20623fd1"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1087/Dovo-Server-Nightly-0.0.9-nightly.1087-linux-arm64.tar.gz"
      sha256 "c9974e341af0586ca4c9eb5e51bdeaedbc03fa82e6ecbd697ba1191a4fec8559"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1087/Dovo-Server-Nightly-0.0.9-nightly.1087-linux-x64.tar.gz"
      sha256 "eafd22663a76bcfdcc9c672751df786d7bca9a12cbcb74c03ed673440697555e"
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
