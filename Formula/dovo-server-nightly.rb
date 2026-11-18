class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.958"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.958/Dovo-Server-Nightly-0.0.9-nightly.958-macos-arm64.tar.gz"
      sha256 "ae1ccb74fffcd9ac680d06da036a6edbc1a7cf4daf2dfd431f5dfb470ddc7b2c"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.958/Dovo-Server-Nightly-0.0.9-nightly.958-linux-arm64.tar.gz"
      sha256 "7d06d5b364c2142eefa44534227f8f74b4103d62592cde7a0c969a1abced1f63"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.958/Dovo-Server-Nightly-0.0.9-nightly.958-linux-x64.tar.gz"
      sha256 "c6e1d06efc027fb71b4bda77efebf1e717e42e68d49090f8c29fde7117ef3420"
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
