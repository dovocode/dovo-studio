class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.926"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.926/Dovo-Server-Nightly-0.0.9-nightly.926-macos-arm64.tar.gz"
      sha256 "90388af6f8d8d4e671bce7b75943cc8a52e5ed941a9f4fddaf1a83e40342d596"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.926/Dovo-Server-Nightly-0.0.9-nightly.926-linux-arm64.tar.gz"
      sha256 "e3a872d269b770c56cad7b4f3eda636c26f396439b3d3429816f9cef2cb66fde"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.926/Dovo-Server-Nightly-0.0.9-nightly.926-linux-x64.tar.gz"
      sha256 "b0ea3c98b47823fdbaf78db290eca1008215341341806a50fdee025dc431efe5"
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
