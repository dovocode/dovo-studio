class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.538"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.538/Dovo-Server-Nightly-0.0.9-nightly.538-macos-arm64.tar.gz"
      sha256 "b57e3e42ffcda35fef83548805a153be91788502d7bfbcdda384363d8ea438eb"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.538/Dovo-Server-Nightly-0.0.9-nightly.538-linux-arm64.tar.gz"
      sha256 "5c349336afc342622eb7e779fc64ba49fbf6bdc91f2e3a6c7e36263ed6cfed42"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.538/Dovo-Server-Nightly-0.0.9-nightly.538-linux-x64.tar.gz"
      sha256 "5f4955a717aa06bf3db3a99c66cfacc77039a28c89401e3cf7ec1ef8edc05f9a"
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
