class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.698"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.698/Dovo-Server-Nightly-0.0.9-nightly.698-macos-arm64.tar.gz"
      sha256 "a499a9b9585805c86d5ce1853b7c3bf03b4ed153afefe6395f8e642bc57bfc01"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.698/Dovo-Server-Nightly-0.0.9-nightly.698-linux-arm64.tar.gz"
      sha256 "4714f08c9dfd61b8c075833c9c4d115e4b8d43e2bd5733858e2a596fba3d4025"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.698/Dovo-Server-Nightly-0.0.9-nightly.698-linux-x64.tar.gz"
      sha256 "d8a77c7589cc2f9081413ea193530a67931b5c95c70d156a24ab34b78ee7de94"
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
