class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.728"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.728/Dovo-Server-Nightly-0.0.9-nightly.728-macos-arm64.tar.gz"
      sha256 "ba60bd47e4d20dccc5cb7d6a4843b641cf4e4f10ce507a8b43bbc54186bf7296"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.728/Dovo-Server-Nightly-0.0.9-nightly.728-linux-arm64.tar.gz"
      sha256 "a81109f9172e31798bc80cb5edfdac20d0123acf60e8781586cecba81ff510a0"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.728/Dovo-Server-Nightly-0.0.9-nightly.728-linux-x64.tar.gz"
      sha256 "20f2a469bda447065ab53ccf3d03261b6a16f596f738db89259b23c79b4e4142"
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
