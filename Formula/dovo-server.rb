class DovoServer < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7/Dovo-Server-0.0.7-macos-arm64.tar.gz"
      sha256 "eb60d3dcea91039c528f6858bb1ecbf9695f6623b9ee4c4b7be20b5f38d6b0ff"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7/Dovo-Server-0.0.7-linux-arm64.tar.gz"
      sha256 "b6bc34ae39e09d73a2fb573e0c29f0fd3fece760239e1c25d0603ec7764fe4c8"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7/Dovo-Server-0.0.7-linux-x64.tar.gz"
      sha256 "431d6fbfb90518166c06be4fbb933f30445ee526c03f6ab66cdb76affd4de710"
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
