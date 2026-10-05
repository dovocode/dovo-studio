class DovoServer < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.8"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.8/Dovo-Server-0.0.8-macos-arm64.tar.gz"
      sha256 "efbaff1faa8538fbcfd570a9299ed900c8c412a751277ebc417dade0ea92181b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.8/Dovo-Server-0.0.8-linux-arm64.tar.gz"
      sha256 "b183c8ca597526cd1f0177d0cb21db14d9fec375d78db6bae09259543c4750df"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.8/Dovo-Server-0.0.8-linux-x64.tar.gz"
      sha256 "0cb4cb7c22529732cbf63eeb9ef4b67953f25b447dd07d44de953e9f67610f85"
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
