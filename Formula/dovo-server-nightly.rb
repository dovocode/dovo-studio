class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.879"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.879/Dovo-Server-Nightly-0.0.9-nightly.879-macos-arm64.tar.gz"
      sha256 "9df21a6ecc109ae932a5d5a0e23edea23a38035f9e1f861fc4cbd7c049ea7b29"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.879/Dovo-Server-Nightly-0.0.9-nightly.879-linux-arm64.tar.gz"
      sha256 "9cddf5c1c1fa68fbce32e17104da0650671cfe3618bd310e045e98599d27b69f"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.879/Dovo-Server-Nightly-0.0.9-nightly.879-linux-x64.tar.gz"
      sha256 "cb8b6969efd0239209d1446cc905dbeece9f16a998e2835252e8e1ccc26d8c7d"
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
