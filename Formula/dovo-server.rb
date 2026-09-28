class DovoServer < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.6"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.6/Dovo-Server-0.0.6-macos-arm64.tar.gz"
      sha256 "0766b896494c8efb111cf6c6f37cb7a2ca4afe889da6049a98c797d3802447e9"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.6/Dovo-Server-0.0.6-linux-arm64.tar.gz"
      sha256 "130f2d368c9546402b8f4cb0f77af89bfc4f022ae2c9aa10c71fe733d588563d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.6/Dovo-Server-0.0.6-linux-x64.tar.gz"
      sha256 "f38008e5047cb3340cb47a902ba46ebe9e01a85b655ee3504446f620f5f28c83"
    end
  end
  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/dovo-server"
  end
  def caveats
    <<~EOS
      Configure: dovo-server setup
      Start:     dovo-server start
      Pair:      dovo-server pair
      Finish active work and stop before upgrading, then start again.
      Data is stored in ~/.dovo by default and is never removed by uninstall.
      This formula does not register an automatic login service.
    EOS
  end
  test do
    assert_match "Usage:", shell_output("#{bin}/dovo-server --help")
  end
end
