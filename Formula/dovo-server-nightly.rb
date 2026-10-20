class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.415"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.415/Dovo-Server-Nightly-0.0.9-nightly.415-macos-arm64.tar.gz"
      sha256 "7bcc909caaa4090dee306f4a05ab5332ba6802d359627da8a66c7c625f1e189d"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.415/Dovo-Server-Nightly-0.0.9-nightly.415-linux-arm64.tar.gz"
      sha256 "b38ffa403d7c5e3a40d8806d770d6801d1579fc4d9cd95fcee75d94feebf4a96"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.415/Dovo-Server-Nightly-0.0.9-nightly.415-linux-x64.tar.gz"
      sha256 "f8efebc4f7f56169e47876fdc48aa0c16697716ddd9efcd2b0a13d888d609bb7"
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
