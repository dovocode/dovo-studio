class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.7-nightly.86"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.86/Dovo-Server-Nightly-0.0.7-nightly.86-macos-arm64.tar.gz"
      sha256 "a209f5b6157ac7d9ae10231492f73540d1c434ae0447ddbe7d7d2bcab2439142"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.86/Dovo-Server-Nightly-0.0.7-nightly.86-linux-arm64.tar.gz"
      sha256 "2cb87002879d0b0290b841d94dcb78b984a431776562ea9dbc33d506b115f16a"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.86/Dovo-Server-Nightly-0.0.7-nightly.86-linux-x64.tar.gz"
      sha256 "c07233d7b1eb8312a24edd2e548823cc6250c39414ca8e361b49e89f01897e0a"
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
