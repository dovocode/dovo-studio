class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.410"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.410/Dovo-Server-Nightly-0.0.9-nightly.410-macos-arm64.tar.gz"
      sha256 "a547a9ded7376aee9982fa55329ad31b9b60917eab46f2bfb82855c5c28674ce"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.410/Dovo-Server-Nightly-0.0.9-nightly.410-linux-arm64.tar.gz"
      sha256 "682725d4d209f46cf776dd83351a66337f8ee85c5c86aa4df74c94884a5fed52"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.410/Dovo-Server-Nightly-0.0.9-nightly.410-linux-x64.tar.gz"
      sha256 "d5d8161c771f1879acf629eefd84a219aabc5fe63fae914075e32de26b695db8"
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
