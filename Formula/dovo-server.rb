class DovoServer < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.5"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.5/Dovo-Server-0.0.5-macos-arm64.tar.gz"
      sha256 "1bf45f91005c7ecc67bd684dab0af7de991a519c8ce290b40d4394a8389d0d85"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.5/Dovo-Server-0.0.5-linux-arm64.tar.gz"
      sha256 "e648da0fcce096fb17e5e069b6343762f67c520363a8851447602830a34395db"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.5/Dovo-Server-0.0.5-linux-x64.tar.gz"
      sha256 "dd10f0a1016d581a3c2a77fa0df14f2d73ce22fccc80858bb4d6c2f7798e77eb"
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
