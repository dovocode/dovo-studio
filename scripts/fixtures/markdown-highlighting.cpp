#include "CodeBlockHighlighter.hpp"
#include <cassert>
#include <iostream>
#include <utility>

using namespace Markdown;

static void expectType(const std::string &code, const char *language, const std::string &text,
                       HighlightTokenType type) {
  const auto start = code.find(text);
  assert(start != std::string::npos);
  bool found = false;
  for (const auto &token : highlightCode(code, language)) {
    if (token.start <= start && token.end >= start + text.size()) {
      assert(token.type == type);
      found = true;
    }
  }
  assert(found);
}

int main() {
  for (auto sample : {
    std::pair{"js", "// Comment\nconst greeting = \"Hello\"; greet(42);"},
    std::pair{"ts", "// Comment\nconst greeting: string = \"Hello\"; greet(42);"},
    std::pair{"tsx", "// Comment\nconst view = <div title=\"Hello\">{42}</div>;"},
    std::pair{"json", "{\"answer\": 42}"},
    std::pair{"bash", "echo \"hello\""},
    std::pair{"css", ".hello { color: red; }"},
    std::pair{"html", "<div title=\"Hello\">World</div>"},
    std::pair{"python", "def greet():\n  return \"hello\""},
    std::pair{"yaml", "answer: 42"}
  }) {
    auto tokens = highlightCode(sample.second, sample.first);
    assert(!tokens.empty());
    for (const auto &token : tokens)
      assert(token.start < token.end && token.end <= std::string(sample.second).size());
    std::cout << sample.first << ": " << tokens.size() << " tokens verified\n";
  }

  for (auto language : {"js", "ts", "TS", "typescript", "tsx"}) {
    const std::string code = "// Comment\nconst lowercase = \"Hello\"; greet(42); new Widget(); require('module');";
    expectType(code, language, "// Comment", HighlightTokenType::Comment);
    expectType(code, language, "const", HighlightTokenType::Keyword);
    expectType(code, language, "lowercase", HighlightTokenType::Variable);
    expectType(code, language, "Hello", HighlightTokenType::String);
    expectType(code, language, "greet", HighlightTokenType::Function);
    expectType(code, language, "42", HighlightTokenType::Number);
    expectType(code, language, "Widget", HighlightTokenType::Type);
    expectType(code, language, "require", HighlightTokenType::Function);
  }

  // Native attributed strings use UTF-16 offsets, including after surrogate pairs.
  bool number = false;
  for (const auto &token : highlightCode(u8"const greeting = \"👋\"; const answer = 42;", "js")) {
    if (token.type == HighlightTokenType::Number) {
      assert(token.start == 38 && token.end == 40);
      number = true;
    }
  }
  assert(number);
  assert(highlightCode("plain code", "unsupported-language").empty());
  assert(highlightCode("plain code", "").empty());
  assert(highlightCode("", "ts").empty());
  assert(highlightCode(std::string(51 * 1024, 'a'), "ts").empty());
  assert(highlightCode(std::string(2001, '\n'), "ts").empty());
  std::cout << "Query predicates, inherited TS captures, aliases, UTF-16 offsets and safe fallbacks verified\n";
}
