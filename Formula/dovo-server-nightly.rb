class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.774"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.774/Dovo-Server-Nightly-0.0.9-nightly.774-macos-arm64.tar.gz"
      sha256 "6f6a35d370c632e92922ae7e817a68cf1967afe0e5f8f5bd3aed2bffe055e64d"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.774/Dovo-Server-Nightly-0.0.9-nightly.774-linux-arm64.tar.gz"
      sha256 "76d4320e9ef1f3adf294efe02bb84f1534e7483acb166b6690d66544225fd444"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.774/Dovo-Server-Nightly-0.0.9-nightly.774-linux-x64.tar.gz"
      sha256 "eead171200d4230d8df73e20d7ee80532010ae8ba1a92a90e387dcddf7d9fa61"
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
