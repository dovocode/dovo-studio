class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.383"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.383/Dovo-Server-Nightly-0.0.9-nightly.383-macos-arm64.tar.gz"
      sha256 "c3cb27579f29da9e74f05a37ab0fca8aae91483df672982e90807dd3e9a378c5"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.383/Dovo-Server-Nightly-0.0.9-nightly.383-linux-arm64.tar.gz"
      sha256 "a96315701bc69db438788335c0615d5c81e65c76a3c8af38535a293252d5e5f3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.383/Dovo-Server-Nightly-0.0.9-nightly.383-linux-x64.tar.gz"
      sha256 "d10635c1553feb3a29691209256c6656173e26353cdfb400b8c88313e36ce598"
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
