class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.158"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.158/Dovo-Server-Nightly-0.0.7-nightly.158-macos-arm64.tar.gz"
      sha256 "bbe399adf9fa1ab96b0d9cef7bd20d390cb1057ed110728b3c37b91008b1c8bd"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.158/Dovo-Server-Nightly-0.0.7-nightly.158-linux-arm64.tar.gz"
      sha256 "6ae5d4140ea72932aa13b5f81122b3118bd771a2094d8d1d0c7af6d84fe76dc8"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.158/Dovo-Server-Nightly-0.0.7-nightly.158-linux-x64.tar.gz"
      sha256 "55379cb68180a2eaec955bd4ee137f8baac32c8d1ebb1426a4aa9d71b472235f"
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
