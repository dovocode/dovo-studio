class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.92"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.92/Dovo-Server-Nightly-0.0.7-nightly.92-macos-arm64.tar.gz"
      sha256 "d8937e95840e379245f506013360415e5b2b402208fff416baeb78ac7029cba7"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.92/Dovo-Server-Nightly-0.0.7-nightly.92-linux-arm64.tar.gz"
      sha256 "2095e3f73ddf153502ed6bbdccf7a9628dcae98259c11fdb386132d520be5c29"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.92/Dovo-Server-Nightly-0.0.7-nightly.92-linux-x64.tar.gz"
      sha256 "c05a538cf3d76585ac671caa0d618f001ccd75ac62a99f6a8f42fc0a7b6240ef"
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
