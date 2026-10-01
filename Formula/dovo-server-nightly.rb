class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.110"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.110/Dovo-Server-Nightly-0.0.7-nightly.110-macos-arm64.tar.gz"
      sha256 "61cf62fd1fc9442c103ec85281684da1e49d201ded106c61c712ae4322f7ce36"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.110/Dovo-Server-Nightly-0.0.7-nightly.110-linux-arm64.tar.gz"
      sha256 "fb54161b3eda6b2c3d183c95eb388b92616f6f3678cfa26a584ddc81fa331b89"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.110/Dovo-Server-Nightly-0.0.7-nightly.110-linux-x64.tar.gz"
      sha256 "39f3ad1cee73be7763466d0f65b202c6778bfa9f1f3b8afb04509b9c2bca4c8b"
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
