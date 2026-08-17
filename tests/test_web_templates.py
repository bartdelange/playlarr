import unittest
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

TEMPLATE_DIRECTORY = Path(__file__).parents[1] / "src/music_importer/web/templates"
MAX_TEMPLATE_LINE_LENGTH = 150


class WebTemplateTests(unittest.TestCase):
    def test_every_template_compiles(self):
        environment = Environment(loader=FileSystemLoader(TEMPLATE_DIRECTORY))

        for path in sorted(TEMPLATE_DIRECTORY.glob("*.html")):
            with self.subTest(template=path.name):
                environment.get_template(path.name)

    def test_template_lines_stay_readable(self):
        for path in sorted(TEMPLATE_DIRECTORY.glob("*.html")):
            for line_number, line in enumerate(path.read_text().splitlines(), start=1):
                with self.subTest(template=path.name, line=line_number):
                    self.assertLessEqual(len(line), MAX_TEMPLATE_LINE_LENGTH)


if __name__ == "__main__":
    unittest.main()
