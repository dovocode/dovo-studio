class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.840"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.840/Dovo-Server-Nightly-0.0.9-nightly.840-macos-arm64.tar.gz"
      sha256 "e0c1ff971bc1d22a7d7bc0ba3c2af5272094b2914196be31dd7f291d4c7e62e8"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.840/Dovo-Server-Nightly-0.0.9-nightly.840-linux-arm64.tar.gz"
      sha256 "7f34269096938f768e47f9f26388bdc50dd10d3f3663b25e2f743e810179d889"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.840/Dovo-Server-Nightly-0.0.9-nightly.840-linux-x64.tar.gz"
      sha256 "4a7b93ef8b89e36157b972a1acdbb643120f0bd6dd0992d45f1d164b4f46681d"
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
