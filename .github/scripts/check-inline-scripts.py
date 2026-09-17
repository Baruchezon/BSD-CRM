from html.parser import HTMLParser
from pathlib import Path
import subprocess
import sys


class InlineScriptParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.capture = False
        self.current = []
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "script":
            return
        attr_map = dict(attrs)
        self.capture = "src" not in attr_map
        self.current = []

    def handle_data(self, data):
        if self.capture:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.capture:
            self.scripts.append("".join(self.current))
            self.capture = False
            self.current = []


def check_file(path: Path):
    parser = InlineScriptParser()
    parser.feed(path.read_text(encoding="utf-8"))
    for index, source in enumerate(parser.scripts, start=1):
        if not source.strip():
            continue
        result = subprocess.run(
            ["node", "--check", "-"],
            input=source,
            text=True,
            capture_output=True,
        )
        if result.returncode:
            print(f"{path}: inline script {index} failed syntax check", file=sys.stderr)
            print(result.stderr, file=sys.stderr)
            return False
    print(f"{path}: {len(parser.scripts)} inline scripts passed")
    return True


files = [Path(arg) for arg in sys.argv[1:]]
if not files:
    print("Provide at least one HTML file", file=sys.stderr)
    raise SystemExit(2)

raise SystemExit(0 if all(check_file(path) for path in files) else 1)
