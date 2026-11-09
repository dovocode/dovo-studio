class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.746"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.746/Dovo-Server-Nightly-0.0.9-nightly.746-macos-arm64.tar.gz"
      sha256 "8413d703b0b3290ccdc25476b6e0aad9602f940aadbe7768df946e00ac229145"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.746/Dovo-Server-Nightly-0.0.9-nightly.746-linux-arm64.tar.gz"
      sha256 "0053e77a7e7bb32eadfb9047effed5b7e4f9a4d985b5ba39f95790449229018d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.746/Dovo-Server-Nightly-0.0.9-nightly.746-linux-x64.tar.gz"
      sha256 "b4eaa6b4e1e0acb7fe4e6066512e7991567b1e12f9c196e49a622412921a22a4"
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
