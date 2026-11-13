class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.851"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.851/Dovo-Server-Nightly-0.0.9-nightly.851-macos-arm64.tar.gz"
      sha256 "d686833f8e317fe0e1c98184762adc447b7537d13704f712126e1937ea4aab5d"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.851/Dovo-Server-Nightly-0.0.9-nightly.851-linux-arm64.tar.gz"
      sha256 "bb2319ee0d55bbfb0decf92dbd211b00cbe79efb6e7df9aa0fd3bf6b2d1fea52"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.851/Dovo-Server-Nightly-0.0.9-nightly.851-linux-x64.tar.gz"
      sha256 "f46b5c7eb28aa131b0fbe3d880e720b7a9b6e163a253c53a9e036428209ec001"
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
