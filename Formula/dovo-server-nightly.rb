class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.539"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.539/Dovo-Server-Nightly-0.0.9-nightly.539-macos-arm64.tar.gz"
      sha256 "8233b78bf159252b13a680feb71dee5e6e908a8254b5f84e95ea66848c4f4154"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.539/Dovo-Server-Nightly-0.0.9-nightly.539-linux-arm64.tar.gz"
      sha256 "f31bb0f8010325ccdc5d0f5c4bc725cb6b9942c98c494d5cdfdc39d35f497431"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.539/Dovo-Server-Nightly-0.0.9-nightly.539-linux-x64.tar.gz"
      sha256 "b52b1b6c44476b51d6fe290612edc30b1c7c12cf4986285aee641660beba7bba"
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
